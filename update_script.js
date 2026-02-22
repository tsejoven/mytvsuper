const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- 1. 智慧分組與過濾邏輯 ---
const getGroupAndFilter = (name) => {
  if (!name) return null;
  const n = name.toUpperCase();
  
  // A. 優先識別港澳台 (擴大關鍵字範圍以增加獲取量)
  if (/翡翠|TVB|TVB plus|Viu|ViuTV|鳳凰|香港|澳門|台灣|台湾|HK|TW|中天|VIU|東森|东森|緯來|纬来|公视|民视|好莱坞|民視|RHK|三立|八大|TVBS|无线|有线|華視|华视|台视|HOY|Now|NOW|now|ELta|ELTA|爱尔达|愛爾達|中视|凤凰|台視|中視|龍祥|DISCOVERY|HBO|HBo|FOX|CNN/.test(n)) {
    return "港澳台";
  }
  
  // B. 識別央視
  if (n.includes("CCTV") || n.includes("央视") || n.includes("央視")) {
    return "央視頻道";
  }
  
  // C. 識別體育
  if (n.includes("體育") || n.includes("体育") || n.includes("SPORT") || n.includes("NBA") || n.includes("五星") || n.includes("足球") || n.includes("广东体育") || n.includes("賽馬")) {
    return "體育節目";
  }

  // D. 識別省級衛視
  if (n.includes("衛視") || n.includes("卫视")) {
    return "省級衛視";
  }
  
  return null;
};

// --- 2. 數據源列表 (已修正註釋語法) ---
const SOURCE_URLS = [
  "https://php.946985.filegear-sg.me/jackTV.m3u",
  "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u",
  "https://raw.githubusercontent.com/YueChan/Live/main/IPTV.m3u",
  "https://raw.githubusercontent.com/Guovern/iptv/master/docs/iptv.m3u",
  "https://raw.githubusercontent.com/YueChan/Live/refs/heads/main/GNTV.m3u",
  "https://raw.githubusercontent.com/suxuang/myIPTV/main/ipv4.m3u",
  "https://raw.githubusercontent.com/Free-TV/IPTV/refs/heads/master/playlist.m3u8",
  "https://raw.githubusercontent.com/CCSH/IPTV/refs/heads/main/live.m3u",
  "https://raw.githubusercontent.com/Jsnzkpg/Jsnzkpg/refs/heads/Jsnzkpg/Jsnzkpg1.m3u",
   "https://raw.githubusercontent.com/judy-gotv/iptv/refs/heads/main/ofiii.m3u"
];

async function update() {
  console.log("🚀 啟動高效校驗引擎...");
  let rawChannels = [];
  const commonHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36' };

  // --- 第一步：抓取 ---
  for (const url of SOURCE_URLS) {
    try {
      console.log(`📡 抓取源: ${url.substring(0, 50)}...`);
      const res = await axios.get(url, { timeout: 15000, headers: commonHeaders });
      const lines = res.data.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('#EXTINF')) {
          const namePart = lines[i].split(',')[1];
          const name = namePart ? namePart.trim() : "未知頻道";
          const streamUrl = lines[i + 1] ? lines[i + 1].trim() : null;
          if (streamUrl && streamUrl.startsWith('http')) {
            const group = getGroupAndFilter(name);
            if (group) rawChannels.push({ name, url: streamUrl, group });
          }
        }
      }
    } catch (e) {
      console.error(`⚠️ 抓取失敗: ${url.substring(0, 30)}`);
    }
  }

  // 初步去重
  const uniqueUrlMap = new Map();
  rawChannels.forEach(c => uniqueUrlMap.set(c.url, c));
  const uniqueChannels = Array.from(uniqueUrlMap.values());
  console.log(`📊 篩選後待校驗線路: ${uniqueChannels.length}`);

  // --- 第二步：高速併發校驗 ---
  const testedChannels = [];
  const batchSize = 50; 
  
  for (let i = 0; i < uniqueChannels.length; i += batchSize) {
    const batch = uniqueChannels.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (channel) => {
      const start = Date.now();
      try {
        // 使用 HEAD 請求快速檢測
        await axios.head(channel.url, { 
          timeout: 3000, 
          headers: commonHeaders,
          validateStatus: (status) => status >= 200 && status < 400
        });
        return { ...channel, latency: Date.now() - start };
      } catch (e) {
        // 如果 HEAD 失敗，嘗試小流量 GET
        try {
          await axios.get(channel.url, { timeout: 2000, headers: commonHeaders, responseType: 'stream' });
          return { ...channel, latency: Date.now() - start };
        } catch (e2) {
          return null;
        }
      }
    }));
    
    testedChannels.push(...results.filter(r => r !== null));
    console.log(`🔄 校驗進度: ${Math.min(i + batchSize, uniqueChannels.length)} / ${uniqueChannels.length} (有效: ${testedChannels.length})`);
  }

  // --- 第三步：聚合與排序 ---
  const mergedMap = new Map();
  testedChannels.forEach(channel => {
    if (!mergedMap.has(channel.name)) mergedMap.set(channel.name, []);
    mergedMap.get(channel.name).push(channel);
  });

  let finalM3U = "#EXTM3U x-tvg-url=\"http://epg.51zmt.top:8000/e.xml\"\n";
  mergedMap.forEach((sources, name) => {
    sources.sort((a, b) => a.latency - b.latency);
    sources.forEach((s, index) => {
      const displayName = index === 0 ? name : `${name} (線路${index + 1})`;
      finalM3U += `#EXTINF:-1 group-title="${s.group}" tvg-name="${name}",${displayName}\n${s.url}\n`;
    });
  });

  const dir = './data';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'subscription.m3u'), finalM3U);
  console.log(`✅ 完成！保留頻道: ${mergedMap.size}, 線路: ${testedChannels.length}`);
}

update().catch(err => console.error("❌ 嚴重錯誤:", err));
