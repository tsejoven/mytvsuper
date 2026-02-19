const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- 1. 智慧分組與過濾邏輯 ---
const getGroupAndFilter = (name) => {
  const n = name.toUpperCase();
  
  // A. 優先識別港澳台 (擴大關鍵字範圍以增加獲取量)
  if (/翡翠|TVB|TVB plus|Viu|ViuTV|鳳凰|香港|澳門|台灣|台湾|HK|TW|中天|VIU|東森|东森|緯來|纬来|公视|民视|好莱坞|民視|RHK|三立|八大|TVBS|无线|華視|华视|台视|HOY|Now|NOW|now|中视|凤凰|台視|中視|龍祥|DISCOVERY|HBO|FOX|CNN/.test(n)) {
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
  "https://raw.githubusercontent.com/fafa002/yf2025/refs/heads/main/yiyifafa.txt"
  "https://raw.githubusercontent.com/Jsnzkpg/Jsnzkpg/refs/heads/Jsnzkpg/Jsnzkpg1.m3u",
  // 增加針對港澳台的特定源
  "https://raw.githubusercontent.com/Moexin/IPTV/main/TV.m3u",
  "https://raw.githubusercontent.com/YueChan/Live/refs/heads/main/GNTV.m3u",
  "https://raw.githubusercontent.com/billy21/tv-list/master/test.m3u"
];

async function update() {
  console.log("開始抓取並過濾直播源...");
  let rawChannels = [];

  for (const url of SOURCE_URLS) {
    try {
      console.log(`正在抓取: ${url}`);
      const res = await axios.get(url, { timeout: 15000 });
      const lines = res.data.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('#EXTINF')) {
          const name = lines[i].split(',')[1]?.trim() || "未知頻道";
          const streamUrl = lines[i + 1]?.trim();
          
          if (streamUrl && streamUrl.startsWith('http')) {
            const group = getGroupAndFilter(name);
            // 關鍵修改：只有屬於我們想要的分組，才加入列表
            if (group) {
              rawChannels.push({ name, url: streamUrl, group: group });
            }
          }
        }
      }
    } catch (e) {
      console.log(`跳過失效源 ${url}: ${e.message}`);
    }
  }

  // 去重
  const uniqueChannels = Array.from(new Map(rawChannels.map(c => [c.url, c])).values());
  console.log(`抓取完成，符合條件的頻道共 ${uniqueChannels.length} 個。`);

  // --- 3. 併發校驗 ---
  const validChannels = [];
  const batchSize = 25; 

  for (let i = 0; i < uniqueChannels.length; i += batchSize) {
    const batch = uniqueChannels.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (channel) => {
      try {
        await axios.head(channel.url, { timeout: 4000 });
        return channel;
      } catch (e) {
        return null;
      }
    }));
    validChannels.push(...results.filter(r => r !== null));
    console.log(`校驗進度: ${Math.min(i + batchSize, uniqueChannels.length)} / ${uniqueChannels.length}`);
  }

  // --- 4. 生成檔案 ---
  const dir = './data';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  let m3u = "#EXTM3U\n";
  validChannels.forEach(c => {
    m3u += `#EXTINF:-1 group-title="${c.group}",${c.name}\n${c.url}\n`;
  });

  fs.writeFileSync(path.join(dir, 'subscription.m3u'), m3u);
  console.log(`更新完成！有效頻道總數: ${validChannels.length}`);
}

update();
