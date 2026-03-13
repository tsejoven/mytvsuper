const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');

// 使用與舊版一致的 Agent 設定
const agent = new https.Agent({ rejectUnauthorized: false });

// 智慧分組邏輯 (保留舊版的高兼容關鍵字)
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
  "https://raw.githubusercontent.com/250992941/tv2/refs/heads/main/assets/freetv/freetv_output_other.txt",
  "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u",
  "https://raw.githubusercontent.com/YueChan/Live/main/IPTV.m3u",
  "https://raw.githubusercontent.com/Guovern/iptv/master/docs/iptv.m3u",
  "https://raw.githubusercontent.com/alantang1977/X/refs/heads/main/live/live_ipv4.m3u"
];

async function update() {
  console.log("🚀 執行優化平衡版校驗 (解析邏輯回歸舊版)...");
  let rawChannels = [];
  const commonHeaders = { 'User-Agent': 'Mozilla/5.0' };

  for (const url of SOURCE_URLS) {
    try {
      console.log(`📡 抓取源: ${url.substring(0, 50)}...`);
      const res = await axios.get(url, { timeout: 20000, headers: commonHeaders, httpsAgent: agent });
      // 使用更精確的換行符切割
      const lines = res.data.split(/\r?\n/);
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        let name = "", streamUrl = "";

        // 回歸舊版的核心解析邏輯
        if (line.startsWith('#EXTINF')) {
          const parts = line.split(',');
          name = parts[parts.length - 1].trim(); // 拿最後一部分作為名稱
          streamUrl = lines[i + 1] ? lines[i + 1].trim() : "";
          i++; 
        } 
        else if (line.includes(',') && line.includes('http')) {
          const parts = line.split(',');
          name = parts[0].trim();
          streamUrl = parts[1] ? parts[1].trim() : "";
        }

        if (streamUrl && streamUrl.startsWith('http')) {
          const group = getGroupAndFilter(name);
          if (group) rawChannels.push({ name, url: streamUrl, group });
        }
      }
    } catch (e) { console.error(`⚠️ 抓取失敗: ${url.substring(0, 30)}`); }
  }

  const uniqueChannels = Array.from(new Map(rawChannels.map(c => [c.url, c])).values());
  console.log(`📊 抓取完成，有效線路總數: ${uniqueChannels.length}`);

  // 校驗階段：使用與舊版一致的 batchSize = 20
  const testedChannels = [];
  const batchSize = 20; 
  for (let i = 0; i < uniqueChannels.length; i += batchSize) {
    const batch = uniqueChannels.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (channel) => {
      const start = Date.now();
      try {
        const res = await axios.get(channel.url, { 
          timeout: 5000, // 稍微放寬到 5 秒增加保留率
          responseType: 'stream', 
          httpsAgent: agent 
        });
        res.data.destroy();
        return { ...channel, latency: Date.now() - start };
      } catch (e) { return null; }
    }));
    testedChannels.push(...results.filter(r => r !== null));
  }

  // 生成 M3U... (其餘邏輯與舊版一致)
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
  console.log(`✅ 完成！頻道: ${mergedMap.size}, 線路: ${testedChannels.length}`);
}

update().catch(err => console.error(err));

