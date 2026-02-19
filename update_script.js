const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- 1. 智慧分組邏輯 (優化版：含港澳台識別) ---
const getGroup = (name) => {
  const n = name.toUpperCase();
  // 央視識別
  if (n.includes("CCTV") || n.includes("央視")) return "央視頻道";
  // 港澳台識別 (增加更多關鍵字)
  if (/翡翠|TVB|J2|鳳凰|香港|澳門|台灣|HK|TW|中天|東森|緯來|年代|民視|三立|八大|TVBS/.test(n)) return "港澳台";
  // 衛視識別
  if (n.includes("衛視")) return "省級衛視";
  // 體育識別
  if (n.includes("體育") || n.includes("SPORT") || n.includes("NBA") || n.includes("五星")) return "體育節目";
  // 影視識別
  if (n.includes("電影") || n.includes("MOVIE") || n.includes("影視") || n.includes("劇場")) return "影視劇場";
  
  return "其他頻道";
};

// --- 2. 數據源列表 (你可以隨時在這裡增加新的訂閱地址) ---
const SOURCE_URLS = [
  "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u",
  "https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u",
  "https://raw.githubusercontent.com/YueChan/Live/main/IPTV.m3u",
  "https://raw.githubusercontent.com/Guovern/iptv/master/docs/iptv.m3u"
];

async function update() {
  console.log("開始抓取直播源...");
  let rawChannels = [];

  // 抓取流程
  for (const url of SOURCE_URLS) {
    try {
      console.log(`正在抓取: ${url}`);
      const res = await axios.get(url, { timeout: 15000 });
      const lines = res.data.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('#EXTINF')) {
          // 提取名稱
          const name = lines[i].split(',')[1]?.trim() || "未知頻道";
          // 提取網址 (下一行)
          const streamUrl = lines[i + 1]?.trim();
          
          if (streamUrl && streamUrl.startsWith('http')) {
            rawChannels.push({ 
              name, 
              url: streamUrl, 
              group: getGroup(name) 
            });
          }
        }
      }
    } catch (e) {
      console.log(`無法讀取源 ${url}: ${e.message}`);
    }
  }

  // 移除重複的網址
  const uniqueChannels = Array.from(new Map(rawChannels.map(c => [c.url, c])).values());
  console.log(`抓取完成，總計 ${uniqueChannels.length} 個待校驗頻道。`);

  // --- 3. 併發校驗流程 ---
  const validChannels = [];
  const batchSize = 20; // 每次同時校驗 20 個頻道

  for (let i = 0; i < uniqueChannels.length; i += batchSize) {
    const batch = uniqueChannels.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (channel) => {
      try {
        // 使用 HEAD 請求快速檢查連結是否有效
        await axios.head(channel.url, { 
          timeout: 4000,
          headers: { 'User-Agent': 'Mozilla/5.0' } 
        });
        return channel;
      } catch (e) {
        return null; // 失效則回傳空值
      }
    }));
    
    validChannels.push(...results.filter(r => r !== null));
    console.log(`校驗進度: ${Math.min(i + batchSize, uniqueChannels.length)} / ${uniqueChannels.length}`);
  }

  // --- 4. 生成檔案 ---
  // 建立 data 資料夾
  const dir = './data';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  // 生成 M3U 訂閱內容
  let m3u = "#EXTM3U x-tvg-url=\"http://epg.51zmt.top:8000/e.xml\"\n";
  validChannels.forEach(c => {
    m3u += `#EXTINF:-1 tvg-name="${c.name}" group-title="${c.group}",${c.name}\n${c.url}\n`;
  });

  // 寫入檔案
  fs.writeFileSync(path.join(dir, 'subscription.m3u'), m3u);
  fs.writeFileSync(path.join(dir, 'channels.json'), JSON.stringify(validChannels, null, 2));

  console.log(`--- 全部完成 ---`);
  console.log(`有效頻道總數: ${validChannels.length}`);
}

// 執行任務
update().catch(err => {
  console.error("執行過程中發生錯誤:", err);
  process.exit(1);
});

