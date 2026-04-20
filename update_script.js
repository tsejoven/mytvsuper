const SOURCE_URLS = [
  // --- 你新增的三个 TXT 源 ---
  "https://raw.nuaa.cf/zgyd11/xiangjiao/main/itvlist.txt",
  "https://gitee.com/flying-snow-wu/tv/raw/main/itvlist.txt",
  "https://gitee.com/ztxiaoyao/tv/raw/master/修改版.txt",
  // --- 原有的 M3U 源 ---
  "https://php.946985.filegear-sg.me/jackTV.m3u",
  "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u",
  "https://raw.githubusercontent.com/YueChan/Live/main/IPTV.m3u",
  "https://raw.githubusercontent.com/Guovern/iptv/master/docs/iptv.m3u"
  // ... 其他原有地址
];

async function update() {
  console.log("🚀 启动混合格式校验引擎...");
  let rawChannels = [];
  const commonHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36' };

  for (const url of SOURCE_URLS) {
    try {
      console.log(`📡 正在抓取: ${url.substring(0, 60)}...`);
      const res = await axios.get(url, { timeout: 15000, headers: commonHeaders });
      const content = res.data;
      const lines = content.split('\n');

      if (content.includes("#EXTM3U")) {
        // --- M3U 解析逻辑 ---
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim().startsWith('#EXTINF')) {
            const name = lines[i].split(',')[1]?.trim() || "未知频道";
            const streamUrl = lines[i + 1]?.trim();
            if (streamUrl && streamUrl.startsWith('http')) {
              const group = getGroupAndFilter(name);
              if (group) rawChannels.push({ name, url: streamUrl, group });
            }
          }
        }
      } else {
        // --- TXT 解析逻辑 (频道名,地址) ---
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
    } catch (e) {
      console.error(`⚠️ 抓取失败: ${url.substring(0, 30)}`);
    }
  }

  // --- 后续的校验和去重逻辑保持不变 ---
  // ... (uniqueUrlMap, batchSize 校验等)
}
