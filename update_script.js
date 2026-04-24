const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// --- 設置全局代理與連接池優化 ---
const agentConfig = { keepAlive: true, maxSockets: 100 };
const httpAgent = new http.Agent(agentConfig);
const httpsAgent = new https.Agent(agentConfig);

// --- 1. 智慧分組邏輯 ---
const getGroupAndFilter = (name) => {
  if (!name) return null;
  const n = name.toUpperCase();
  if (/翡翠|TVB|TVB plus|Viu|ViuTV|鳳凰|香港|澳門|台灣|台湾|HK|TW|中天|VIU|東森|东森|緯來|纬来|公视|民视|好莱坞|民視|RHK|三立|八大|TVBS|无线|有线|華視|华视|台视|HOY|Now|NOW|now|ELta|ELTA|爱尔达|愛爾達|中视|凤凰|台視|中視|龍祥|DISCOVERY|HBO|HBo|FOX|CNN/.test(n)) return "港澳台";
  if (n.includes("CCTV") || n.includes("央视") || n.includes("央視")) return "央視頻道";
  if (n.includes("體育") || n.includes("体育") || n.includes("SPORT") || n.includes("NBA") || n.includes("五星") || n.includes("足球") || n.includes("广东体育") || n.includes("賽馬")) return "體育節目";
  if (n.includes("衛視") || n.includes("卫视")) return "省級衛視";
  return null;
};

const SOURCE_URLS = [
  "https://raw.nuaa.cf/zgyd11/xiangjiao/main/itvlist.txt",
  "https://gitee.com/flying-snow-wu/tv/raw/main/itvlist.txt",
  "https://gitee.com/ztxiaoyao/tv/raw/master/修改版.txt",
  "https://php.946985.filegear-sg.me/jackTV.m3u",
  "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u",
  "https://raw.githubusercontent.com/YueChan/Live/main/IPTV.m3u",
  "https://raw.githubusercontent.com/Guovern/iptv/master/docs/iptv.m3u",
  "https://raw.githubusercontent.com/250992941/tv2/refs/heads/main/assets/freetv/freetv_output_other.txt",
  "https://raw.githubusercontent.com/YueChan/Live/refs/heads/main/GNTV.m3u",
  "https://raw.githubusercontent.com/suxuang/myIPTV/main/ipv4.m3u",
  "https://raw.githubusercontent.com/Free-TV/IPTV/refs/heads/master/playlist.m3u8",
  "https://raw.githubusercontent.com/CCSH/IPTV/refs/heads/main/live.m3u",
  "https://raw.githubusercontent.com/alantang1977/X/refs/heads/main/live/live_ipv4.m3u",
  "https://raw.githubusercontent.com/Jsnzkpg/Jsnzkpg/refs/heads/Jsnzkpg/Jsnzkpg1.m3u",
  "https://raw.githubusercontent.com/judy-gotv/iptv/refs/heads/main/ofiii.m3u"
];

const COMMON_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

// --- 核心優化：更快速的校驗邏輯 ---
async function checkStream(channel) {
  const isGlobal = channel.group === "港澳台";
  const timeoutLimit = isGlobal ? 4500 : 2000; // 略微壓縮時間
  const start = Date.now();

  try {
    const res = await axios.get(channel.url, { 
      timeout: timeoutLimit, 
      headers: COMMON_HEADERS, 
      responseType: 'stream',
      httpAgent,
      httpsAgent
    });

    return new Promise((resolve) => {
      let timer = setTimeout(() => { 
        res.data.destroy(); 
        resolve(null); 
      }, isGlobal ? 3500 : 1500);
      
      res.data.on('data', (chunk) => {
        if (chunk.length > 0) {
          clearTimeout(timer);
          res.data.destroy();
          resolve({ ...channel, latency: Date.now() - start });
        }
      });
      res.data.on('error', () => { 
        clearTimeout(timer); 
        resolve(null); 
      });
    });
  } catch (e) {
    return null;
  }
}

// --- 任務池並行處理器 (核心提速引擎) ---
async function pool(tasks, concurrency) {
  const results = [];
  const executing = new Set();
  let finished = 0;

  for (const task of tasks) {
    const p = Promise.resolve().then(() => checkStream(task));
    results.push(p);
    executing.add(p);
    
    p.then(() => {
        executing.delete(p);
        finished++;
        if (finished % 50 === 0) console.log(`🔄 已完成: ${finished} / ${tasks.length}`);
    });

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

async function update() {
  console.log("🚀 啟動池化併發引擎 (預期提速 5-10 倍)...");
  let rawChannels = [];

  // --- 抓取部分 (保持不變) ---
  for (const url of SOURCE_URLS) {
    try {
      const res = await axios.get(url, { timeout: 8000, headers: COMMON_HEADERS });
      const content = res.data;
      const lines = content.split('\n');
      if (content.includes("#EXTM3U")) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim().startsWith('#EXTINF')) {
            const name = lines[i].split(',')[1]?.trim() || "未知頻道";
            const streamUrl = lines[i + 1]?.trim();
            if (streamUrl && streamUrl.startsWith('http')) {
              const group = getGroupAndFilter(name);
              if (group) rawChannels.push({ name, url: streamUrl, group });
            }
          }
        }
      } else {
        lines.forEach(line => {
          if (line.includes(',') && !line.startsWith('#')) {
            const [name, streamUrl] = line.split(',').map(s => s.trim());
            if (streamUrl && streamUrl.startsWith('http')) {
              const group = getGroupAndFilter(name);
              if (group) rawChannels.push({ name, url: streamUrl, group });
            }
          }
        });
      }
    } catch (e) {}
  }

  const uniqueUrlMap = new Map();
  rawChannels.forEach(c => uniqueUrlMap.set(c.url, c));
  const uniqueChannels = Array.from(uniqueUrlMap.values());
  console.log(`📊 待校驗線路: ${uniqueChannels.length}`);

  // --- 執行池化併發 ---
  // concurrency 設置為 100-150 是比較理想的，不會讓本地 DNS 或帶寬崩潰
  const results = await pool(uniqueChannels, 120);
  const testedChannels = results.filter(r => r !== null);

  // --- 聚合與輸出 ---
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
  console.log(`✅ 完成！有效頻道: ${mergedMap.size}, 線路: ${testedChannels.length}`);
}

update().catch(err => console.error("❌ 嚴重錯誤:", err));
