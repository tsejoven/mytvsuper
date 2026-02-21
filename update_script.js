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
  "https://raw.githubusercontent.com/CCSH/IPTV/refs/heads/main/live.m3u",
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
  console.log("🚀 啟動全能提取與質量優化引擎...");
  let rawChannels = [];

  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
    'Accept': '*/*'
  };

  for (const url of SOURCE_URLS) {
    try {
      console.log(`📡 正在探索源: ${url}`);
      const res = await axios.get(url, { 
        timeout: 25000, 
        headers: commonHeaders
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
      console.error(`⚠️ 跳過不可達源: ${url.substring(0, 30)}... | 原因: ${e.message}`);
    }
  }

  // 初步去重
  const uniqueUrlMap = new Map();
  rawChannels.forEach(c => uniqueUrlMap.set(c.url, c));
  const uniqueChannels = Array.from(uniqueUrlMap.values());

  console.log(`📊 抓取完成，進入校驗階段 (共 ${uniqueChannels.length} 條線路)`);

  // --- 3. 延遲測試與有效性校驗 ---
  const testedChannels = [];
  const batchSize = 10; // 降低併發數以提高非 GitHub 源的成功率

  for (let i = 0; i < uniqueChannels.length; i += batchSize) {
    const batch = uniqueChannels.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (channel) => {
      const start = Date.now();
      try {
        // 使用 GET 請求並限制讀取時間，這對某些特殊伺服器更有效
        await axios.get(channel.url, { 
          timeout: 6000, 
          headers: commonHeaders,
          responseType: 'stream'
        });
        return { ...channel, latency: Date.now() - start };
      } catch (e) {
        return null;
      }
    }));
    
    testedChannels.push(...results.filter(r => r !== null));
    console.log(`🔄 校驗進度: ${Math.min(i + batchSize, uniqueChannels.length)} / ${uniqueChannels.length}`);
  }

  // --- 4. 同名聚合與延遲排序 ---
  const mergedMap = new Map();
  testedChannels.forEach(channel => {
    if (!mergedMap.has(channel.name)) {
      mergedMap.set(channel.name, []);
    }
    mergedMap.get(channel.name).push(channel);
  });

  let finalM3U = "#EXTM3U x-tvg-url=\"http://epg.51zmt.top:8000/e.xml\"\n";
  
  mergedMap.forEach((sources, name) => {
    // 質量排序：延遲越小越靠前
    sources.sort((a, b) => a.latency - b.latency);

    sources.forEach((s, index) => {
      const displayName = index === 0 ? name : `${name} (線路${index + 1})`;
      finalM3U += `#EXTINF:-1 group-title="${s.group}" tvg-name="${name}",${displayName}\n${s.url}\n`;
    });
  });

  // --- 5. 寫入檔案 ---
  const dir = './data';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'subscription.m3u'), finalM3U);

  console.log(`✅ 處理完成！`);
  console.log(`總計保留頻道數: ${mergedMap.size}`);
  console.log(`總計有效線路數: ${testedChannels.length}`);
}

update().catch(err => {
  console.error("❌ 嚴重錯誤:", err);
});

