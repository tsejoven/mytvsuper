const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');

// 忽略 SSL 證書錯誤
const agent = new https.Agent({ rejectUnauthorized: false });

// --- 1. 智慧分組邏輯 ---
const getGroupAndFilter = (name) => {
  if (!name) return null;
  const n = name.toUpperCase();
  if (/翡翠|TVB|Viu|鳳凰|香港|澳門|台灣|台湾|HK|TW|中天|東森|緯來|公视|民视|愛爾達|HBO|FOX|CNN/.test(n)) return "港澳台";
  if (n.includes("CCTV") || n.includes("央视")) return "央視頻道";
  if (n.includes("體育") || n.includes("体育") || n.includes("SPORT") || n.includes("NBA")) return "體育節目";
  if (n.includes("衛視") || n.includes("卫视")) return "省級衛視";
  return null;
};

// --- 2. 數據源列表 ---
const SOURCE_URLS = [
  "https://php.946985.filegear-sg.me/jackTV.m3u",
  "https://raw.githubusercontent.com/250992941/tv2/refs/heads/main/assets/freetv/freetv_output_other.txt",
  "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u",
  "https://raw.githubusercontent.com/YueChan/Live/main/IPTV.m3u",
  "https://raw.githubusercontent.com/Guovern/iptv/master/docs/iptv.m3u",
  "https://raw.githubusercontent.com/alantang1977/X/refs/heads/main/live/live_ipv4.m3u"
];

async function update() {
  console.log("🚀 啟動流式狀態機校驗引擎 (V6.0)...");
  let rawChannels = [];
  const commonHeaders = { 'User-Agent': 'Mozilla/5.0' };

  for (const url of SOURCE_URLS) {
    try {
      console.log(`📡 抓取源: ${url.substring(0, 50)}...`);
      const res = await axios.get(url, { timeout: 20000, headers: commonHeaders, httpsAgent: agent });
      const lines = res.data.split(/\r?\n/);
      
      let tempName = ""; // 用於暫存 M3U 的名稱

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        // 邏輯 A: 發現 M3U 標籤，提取名稱並暫存
        if (line.startsWith('#EXTINF')) {
          const namePart = line.split(',')[1];
          tempName = namePart ? namePart.trim() : "";
          continue; // 繼續看下一行，直到找到 URL
        }

        // 邏輯 B: 如果是 URL (無論是 M3U 的下一行還是 TXT 格式)
        if (line.startsWith('http')) {
          let name = "";
          let streamUrl = line;

          if (tempName) {
            // 這是 M3U 配對成功的 URL
            name = tempName;
            tempName = ""; // 用完清空
          } else if (line.includes(',') || line.includes('#')) {
            // 處理某些怪異格式：URL,名稱
            const parts = line.split(/[,#]/);
            streamUrl = parts[0].trim();
            name = parts[1] ? parts[1].trim() : "未知頻道";
          }
          
          const group = getGroupAndFilter(name);
          if (group && streamUrl.startsWith('http')) {
            rawChannels.push({ name, url: streamUrl, group });
          }
        } 
        // 邏輯 C: 處理標準 TXT 格式 (名稱,URL)
        else if (line.includes(',') && line.includes('http')) {
          const parts = line.split(',');
          const name = parts[0].trim();
          const streamUrl = parts[parts.length - 1].trim(); // 取最後一部分作為 URL

          const group = getGroupAndFilter(name);
          if (group && streamUrl.startsWith('http')) {
            rawChannels.push({ name, url: streamUrl, group });
          }
        }
      }
    } catch (e) { console.error(`⚠️ 抓取失敗: ${url.substring(0, 30)}`); }
  }

  // 去重
  const uniqueChannels = Array.from(new Map(rawChannels.map(c => [c.url, c])).values());
  console.log(`📊 待校驗總線路: ${uniqueChannels.length}`);

  // --- 校驗階段 ---
  const testedChannels = [];
  const batchSize = 15; 
  for (let i = 0; i < uniqueChannels.length; i += batchSize) {
    const batch = uniqueChannels.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (channel) => {
      const start = Date.now();
      try {
        const res = await axios.get(channel.url, { 
          timeout: 5000, 
          responseType: 'stream', 
          httpsAgent: agent,
          headers: commonHeaders
        });
        res.data.destroy();
        return { ...channel, latency: Date.now() - start };
      } catch (e) { return null; }
    }));
    testedChannels.push(...results.filter(r => r !== null));
    process.stdout.write(".");
  }

  // 生成 M3U 檔案
  const mergedMap = new Map();
  testedChannels.forEach(c => {
    if (!mergedMap.has(c.name)) mergedMap.set(c.name, []);
    mergedMap.get(c.name).push(c);
  });

  let finalM3U = "#EXTM3U x-tvg-url=\"http://epg.51zmt.top:8000/e.xml\"\n";
  mergedMap.forEach((sources, name) => {
    sources.sort((a, b) => a.latency - b.latency).forEach((s, idx) => {
      const displayName = idx === 0 ? name : `${name} (線路${idx + 1})`;
      finalM3U += `#EXTINF:-1 group-title="${s.group}" tvg-name="${name}",${displayName}\n${s.url}\n`;
    });
  });

  const dir = './data';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'subscription.m3u'), finalM3U);
  console.log(`\n✅ 完成！頻道: ${mergedMap.size}, 有效線路: ${testedChannels.length}`);
}

update().catch(err => console.error(err));

