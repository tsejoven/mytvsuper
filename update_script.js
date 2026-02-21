const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- 1. 智慧分組與過濾邏輯 ---
const getGroupAndFilter = (name) => {
  const n = name.toUpperCase();
  
  // A. 優先識別港澳台 (擴大關鍵字範圍以增加獲取量)
  if (/翡翠|TVB|TVB plus|Viu|ViuTV|鳳凰|香港|澳門|台灣|台湾|HK|TW|中天|VIU|東森|东森|緯來|纬来|公视|民视|好莱坞|民視|RHK|三立|八大|TVBS|无线|有线|華視|华视|台视|HOY|Now|NOW|now|ELta|ELTA|中视|凤凰|台視|中視|龍祥|DISCOVERY|HBO|HBo|FOX|CNN/.test(n)) {
    return "港澳台";
  }
  
  // B. 識別央視
  if (n.includes("CCTV") ||n.includes("央视") || n.includes("央視")) {
    return "央視頻道";
  }
  
  // C. 識別體育
  if (n.includes("體育") ||n.includes("体育") || n.includes("SPORT") || n.includes("NBA") || n.includes("五星") || n.includes("足球") ||  n.includes("广东体育") || n.includes("賽馬")) {
    return "體育節目";
  }

  // D. 識別省級衛視
  if (n.includes("衛視") || n.includes("卫视") ) {
    return "省級衛視";
  }
  
  // E. 不符合以上條件的全部丟棄 (回傳 null)
  return null;
};

// --- 2. 擴大數據源列表 (增加更多專注於港澳台的源) ---
const SOURCE_URLS = [
  // 綜合源
  "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u",
  "https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u",
  "https://raw.githubusercontent.com/YueChan/Live/main/IPTV.m3u",
  "https://raw.githubusercontent.com/Guovern/iptv/master/docs/iptv.m3u",
  "https://raw.githubusercontent.com/suxuang/myIPTV/main/ipv4.m3u",
  "https://raw.githubusercontent.com/Free-TV/IPTV/refs/heads/master/playlist.m3u8",
  "https://raw.githubusercontent.com/judy-gotv/iptv/refs/heads/main/CricHD.m3u",
  "https://raw.githubusercontent.com/judy-gotv/iptv/refs/heads/main/Nowsports.m3u",
  "https://raw.githubusercontent.com/judy-gotv/iptv/refs/heads/main/ofiii.m3u",
   "https://github.com/fafa002/yf2025/blob/main/yiyifafa.txt",
  "https://raw.githubusercontent.com/Jsnzkpg/Jsnzkpg/refs/heads/Jsnzkpg/Jsnzkpg1.m3u",
  // 增加針對港澳台的特定源
  "https://raw.githubusercontent.com/Moexin/IPTV/main/TV.m3u",
  "https://raw.githubusercontent.com/YueChan/Live/refs/heads/main/GNTV.m3u",
  "https://raw.githubusercontent.com/billy21/tv-list/master/test.m3u",

   // 非 GitHub 網址
"https://gh-proxy.org/https://raw.githubusercontent.com/fafa002/yf2025/refs/heads/main/yiyifafa.txt",
"https://php.946985.filegear-sg.me/jackTV.m3u",
"https://ds65.tv1288.xyz",
];

async function update() {
  console.log("🚀 開始抓取並執行質量優化...");
  let rawChannels = [];

  for (const url of SOURCE_URLS) {
    try {
      const res = await axios.get(url, { 
        timeout: 20000, 
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      
      const lines = res.data.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('#EXTINF')) {
          const namePart = lines[i].split(',')[1];
          const name = namePart ? namePart.trim() : "未知頻道";
          const streamUrl = lines[i + 1] ? lines[i + 1].trim() : null;
          
          if (streamUrl && streamUrl.startsWith('http')) {
            const group = getGroupAndFilter(name);
            if (group) {
              rawChannels.push({ name, url: streamUrl, group: group });
            }
          }
        }
      }
    } catch (e) {
      console.error(`⚠️ 跳過源: ${url} | ${e.message}`);
    }
  }

  // 初步去重（網址相同則視為同一個）
  const uniqueUrlMap = new Map();
  rawChannels.forEach(c => uniqueUrlMap.set(c.url, c));
  const uniqueChannels = Array.from(uniqueUrlMap.values());

  console.log(`📡 正在校驗 ${uniqueChannels.length} 個頻道的質量...`);

  // --- 3. 帶延遲測試的併發校驗 ---
  const testedChannels = [];
  const batchSize = 15; 

  for (let i = 0; i < uniqueChannels.length; i += batchSize) {
    const batch = uniqueChannels.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (channel) => {
      const start = Date.now();
      try {
        await axios.get(channel.url, { 
          timeout: 5000, 
          headers: { 'User-Agent': 'Mozilla/5.0' },
          responseType: 'stream' // 只讀取頭部以節省流量
        });
        const latency = Date.now() - start;
        return { ...channel, latency }; // 記錄延遲時間
      } catch (e) {
        return null;
      }
    }));
    
    testedChannels.push(...results.filter(r => r !== null));
    console.log(`✅ 進度: ${Math.min(i + batchSize, uniqueChannels.length)} / ${uniqueChannels.length}`);
  }

  // --- 4. 同名合併與質量排序邏析 ---
  // 使用 Map 將相同名字的頻道聚合在一起
  const mergedMap = new Map();

  testedChannels.forEach(channel => {
    if (!mergedMap.has(channel.name)) {
      mergedMap.set(channel.name, []);
    }
    mergedMap.get(channel.name).push(channel);
  });

  let finalM3U = "#EXTM3U x-tvg-url=\"http://epg.51zmt.top:8000/e.xml\"\n";
  
  // 遍歷每個頻道名稱
  mergedMap.forEach((sources, name) => {
    // 按延遲升序排序（延遲越小越靠前，質量越高）
    sources.sort((a, b) => a.latency - b.latency);

    // 將同名頻道的不同來源依次寫入 M3U
    // 這樣在播放器中，同一個頻道會有「多條路線」，且最快的那條在第一位
    sources.forEach((s, index) => {
      const displayName = index === 0 ? name : `${name} (線路${index + 1})`;
      finalM3U += `#EXTINF:-1 group-title="${s.group}" tvg-name="${name}",${displayName}\n${s.url}\n`;
    });
  });

  // --- 5. 寫入檔案 ---
  const dir = './data';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'subscription.m3u'), finalM3U);

  console.log(`✨ 優化完成！`);
  console.log(`📊 最終導出頻道名稱數: ${mergedMap.size}`);
  console.log(`🔗 總計有效線路數: ${testedChannels.length}`);
}

update().catch(err => {
  console.error("❌ 運行失敗:", err);
});

