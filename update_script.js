const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');

const agent = new https.Agent({ rejectUnauthorized: false });

// 智慧分組邏輯 (保持高相容性關鍵字)
const getGroupAndFilter = (name) => {
  if (!name) return null;
  const n = name.toUpperCase();
  if (/翡翠|TVB|Viu|鳳凰|香港|澳門|台灣|台湾|HK|TW|中天|東森|緯來|公视|民视|愛爾達|HBO|FOX|CNN/.test(n)) return "港澳台";
  if (n.includes("CCTV") || n.includes("央视")) return "央視頻道";
  if (n.includes("體育") || n.includes("体育") || n.includes("SPORT") || n.includes("NBA")) return "體育節目";
  if (n.includes("衛視") || n.includes("卫视")) return "省級衛視";
  return null;
};

const SOURCE_URLS = [
  "https://php.946985.filegear-sg.me/jackTV.m3u",
  "https://raw.githubusercontent.com/250992941/tv2/refs/heads/main/assets/freetv/freetv_output_other.txt", // TXT 格式
  "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u",
  "https://raw.githubusercontent.com/YueChan/Live/main/IPTV.m3u",
  "https://raw.githubusercontent.com/Guovern/iptv/master/docs/iptv.m3u",
  "https://raw.githubusercontent.com/alantang1977/X/refs/heads/main/live/live_ipv4.m3u"
];

async function update() {
  console.log("🚀 執行 V9.0 深度相容版 (解決 TXT 源抓取不到的問題)...");
  let rawChannels = [];
  const commonHeaders = { 'User-Agent': 'Mozilla/5.0' };

  for (const url of SOURCE_URLS) {
    try {
      console.log(`📡 抓取源: ${url.substring(0, 60)}...`);
      const res = await axios.get(url, { timeout: 20000, headers: commonHeaders, httpsAgent: agent });
      const lines = res.data.split(/\r?\n/);
      
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;

        let name = "", streamUrl = "";

        // --- 邏輯 A: M3U 處理 ---
        if (line.toUpperCase().includes('#EXTINF')) {
          const parts = line.split(',');
          name = parts[parts.length - 1].trim(); 
          // 向上搜尋 URL，防止中間有空白行或標籤行
          for (let j = 1; j <= 3; j++) {
            let nextLine = lines[i + j] ? lines[i + j].trim() : "";
            if (nextLine.startsWith('http')) {
              streamUrl = nextLine;
              i += j; // 更新指標
              break;
            }
          }
        } 
        // --- 邏輯 B: TXT 處理 (強化版) ---
        else if (line.includes('http')) {
          const parts = line.split(',');
          // 遍歷所有部分，找到第一個包含 http 的部分作為 URL
          const urlPart = parts.find(p => p.trim().startsWith('http'));
          if (urlPart) {
            streamUrl = urlPart.trim();
            // 名稱通常在第一部分，或者在 URL 之前的逗號部分
            name = parts[0].split('#')[0].trim(); // 同時處理 頻道名#組名 的情況
          }
        }

        // 最終清理 URL (處理後綴帶有空白或 # 的情況)
        if (streamUrl) {
          streamUrl = streamUrl.split(/[#\s]/)[0];
        }

        if (streamUrl.startsWith('http')) {
          const group = getGroupAndFilter(name);
          if (group) {
            rawChannels.push({ name, url: streamUrl, group });
          }
        }
      }
    } catch (e) { console.error(`⚠️ 抓取失敗: ${url}`); }
  }

  const uniqueChannels = Array.from(new Map(rawChannels.map(c => [c.url, c])).values());
  console.log(`📊 抓取完成，去重後待校驗線路: ${uniqueChannels.length}`);

  // 校驗階段
  const testedChannels = [];
  const batchSize = 15; 
  for (let i = 0; i < uniqueChannels.length; i += batchSize) {
    const batch = uniqueChannels.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (channel) => {
      const start = Date.now();
      try {
        const res = await axios.get(channel.url, { 
          timeout: 6000, 
          responseType: 'stream', 
          httpsAgent: agent,
          headers: commonHeaders
        });
        res.data.destroy();
        return { ...channel, latency: Date.now() - start };
      } catch (e) { return null; }
    }));
    testedChannels.push(...results.filter(r => r !== null));
    if (i % 100 === 0) process.stdout.write(".");
  }

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

