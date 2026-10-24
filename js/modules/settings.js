/**
 * settings.js - 设置（全局必备）
 * 导出/导入全部数据、清空数据、关于说明。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};
  var Knowledge = global.Knowledge;

  /* ---- 第 71 次（C1）：就诊摘要构建器（纯函数，QA 直接消费） ----
     只做拼装呈现，不做任何解读与判断（红线：不诊断、不评分）；
     全部数据在本机拼装，无网络请求。摘要节次与「打印成长报告」互补。 */
  function buildVisitSummary(d) {
    var L = [];
    var baby = (d.settings && d.settings.baby) || {};
    L.push('【就诊摘要】咿呀记 · 生成于 ' + Util.nowLocal().slice(0, 16).replace('T', ' '));
    L.push('（由本机记录自动拼装，供问诊参考，不构成诊断；具体请遵医嘱。）');
    L.push('');
    L.push('◆ 宝宝信息');
    L.push('性别：' + (baby.sex === 'girl' ? '女' : (baby.sex === 'boy' ? '男' : '未设置'))
      + ' ｜ 出生日期：' + (baby.birthDate || '未设置')
      + (baby.preterm ? ' ｜ 早产（孕 ' + (baby.birthGestWeeks || '?') + ' 周，评估请用矫正月龄）' : ''));
    L.push('');
    /* 生长：最近 3 次 */
    var gr = (d.growth || []).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    L.push('◆ 生长记录（最近 3 次，共 ' + gr.length + ' 次）');
    if (gr.length) {
      gr.slice(0, 3).forEach(function (r) {
        L.push(r.date + '  体重 ' + (r.weightKg || '—') + 'kg  身长 ' + (r.heightCm || '—') + 'cm  头围 ' + (r.headCm || '—') + 'cm');
      });
    } else L.push('暂无记录');
    L.push('');
    /* 疫苗 */
    L.push('◆ 疫苗接种');
    if (baby.birthDate && Modules.vaccine && typeof Modules.vaccine._plan === 'function') {
      var plan = Modules.vaccine._plan(baby.birthDate);
      var vdone = (d.vaccines && d.vaccines.done) || {};
      var doneList = plan.filter(function (it) { return vdone[it.key]; });
      L.push('已完成 ' + doneList.length + '/' + plan.length + ' 剂');
      if (doneList.length) {
        L.push('最近接种：' + doneList.slice(-3).map(function (it) {
          return it.name + it.dose + '（' + vdone[it.key] + '）';
        }).join(' ／ '));
      }
    } else L.push('暂无排期信息（未设置生日）');
    L.push('');
    /* 儿保体检 */
    L.push('◆ 儿保体检');
    if (baby.birthDate && Modules.vaccine && typeof Modules.vaccine._planCheckups === 'function') {
      var ck = Modules.vaccine._planCheckups(baby.birthDate);
      var ckDoneMap = (d.checkups && d.checkups.done) || {};
      var ckDone = ck.filter(function (it) { return ckDoneMap[it.key]; });
      L.push('已完成 ' + ckDone.length + '/' + ck.length + ' 次'
        + (ckDone.length ? ('，最近一次：' + ckDone[ckDone.length - 1].name + '（' + ckDoneMap[ckDone[ckDone.length - 1].key] + '）') : ''));
    } else L.push('暂无');
    L.push('');
    /* 发育观察点：预警阳性按官方口径转诊提示；自评未出现给官方规则 */
    var obs = d.milestoneObs || [];
    var warnHit = [], obsNo = 0;
    if (Knowledge) {
      var obsTxt = {};
      Knowledge.MILESTONES.forEach(function (e) { obsTxt[e.id] = e.text; });
      obs.forEach(function (r) {
        if (!r || !obsTxt[r.id]) return;
        if (r.v === 1 && r.id.indexOf('KN-W-') === 0) warnHit.push(obsTxt[r.id]);
        else if (r.v === 0) obsNo++;
      });
    }
    L.push('◆ 发育观察点（家长自记）');
    L.push(warnHit.length
      ? ('预警征象阳性 ' + warnHit.length + ' 条：' + warnHit.join('；') + '（建议儿保科或儿童发育行为科就诊）')
      : '预警征象未见阳性标记');
    L.push('自评「还没出现」共 ' + obsNo + ' 项（1 项未出现建议咨询医生，2 项及以上建议到医疗机构检查——官方口径）');
    L.push('');
    /* 里程碑：最近 3 个 */
    var ms = (d.milestones || []).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    L.push('◆ 里程碑（最近 3 个，共 ' + ms.length + ' 个）');
    if (ms.length) ms.slice(0, 3).forEach(function (r) { L.push(r.date + '  ' + r.title); });
    else L.push('暂无记录');
    L.push('');
    /* 近 7 天日常 */
    var cut7 = new Date(); cut7.setDate(cut7.getDate() - 7);
    function n7(arr, key) {
      return (arr || []).filter(function (r) { return r && r[key] && new Date(r[key]) >= cut7; }).length;
    }
    L.push('◆ 近 7 天日常');
    L.push('喂养 ' + n7(d.feedings, 'start') + ' 次 ｜ 睡眠 ' + n7(d.sleeps, 'start') + ' 段 ｜ 换尿布 ' + n7(d.diapers, 'time') + ' 次');
    L.push('');
    /* 妈妈情绪（近 14 天） */
    var cut14 = new Date(); cut14.setDate(cut14.getDate() - 14);
    var mood14 = (d.moods || []).filter(function (r) { return r && r.time && new Date(r.time) >= cut14; });
    var moodLow = mood14.filter(function (r) { return r.level && r.level <= 2; }).length;
    L.push('◆ 妈妈情绪（近 14 天自记 ' + mood14.length + ' 次' + (mood14.length ? ('，其中偏低 ' + moodLow + ' 次') : '') + '）');
    L.push('（情绪为本人自述，仅供问诊参考。）');
    L.push('');
    /* 经期（有记录才出） */
    var per = (d.periods || []).slice().sort(function (a, b) { return (b.start || '').localeCompare(a.start || ''); })[0];
    if (per && per.start) {
      L.push('◆ 经期（妈妈健康）');
      L.push('最近一次开始：' + per.start + (per.end ? ('，' + per.end + ' 结束') : '，进行中') + '（产后/哺乳期不规律属常见现象）');
      L.push('');
    }
    L.push('—— 以上数据来自本机记录，未经任何云端或第三方。');
    return L.join('\n');
  }

  /* ---- 第 83 次（C2）：数据分享照片卡片——把本机记录画成一张可保存/可分享的图片。
     纯本地、零依赖：不引 html2canvas，直接用原生 canvas 绘制（与 Util.pickPhoto 同一范式）。
     分两层：buildShareCardData 是纯函数（只拼文本与统计，QA 可直测）；renderShareCard
     才碰 canvas/document（仅浏览器内调用）。全部数据在本机绘制，照片与记录不出这台设备。 */
  function buildShareCardData(d) {
    d = d || {};
    var today = Util.todayISO();
    var now = new Date();
    var WD = ['日', '一', '二', '三', '四', '五', '六'];
    var weekday = '星期' + WD[now.getDay()];
    var festival = (typeof Util.festivalOf === 'function') ? Util.festivalOf(now) : null;
    var baby = (global.Storage && typeof Storage.activeBaby === 'function') ? Storage.activeBaby() : null;
    var babyName = (baby && baby.name) ? baby.name : '';
    var birthDate = (baby && baby.birthDate) || (d.settings && d.settings.baby && d.settings.baby.birthDate) || null;
    var photoDataURL = (baby && baby.photo) || null;
    var preterm = !!(d.settings && d.settings.baby && d.settings.baby.preterm);
    var ageText = '—';
    if (birthDate) {
      var days = Util.daysBetween(birthDate, today);
      if (days < 0) ageText = '还没出生';
      else if (days === 0) ageText = '出生第 1 天';
      else {
        var months = Math.floor(days / 30.44);
        if (months >= 12) {
          var yrs = Math.floor(months / 12);
          var rm = months % 12;
          ageText = yrs + ' 岁' + (rm ? (' ' + rm + ' 个月') : '');
        } else if (months > 0) {
          var remDays = Math.round(days - months * 30.44);
          ageText = months + ' 个月' + (remDays > 0 ? (' ' + remDays + ' 天') : '');
        } else {
          ageText = days + ' 天';
        }
      }
    }
    function cnt(arr, key) {
      return (arr || []).filter(function (r) {
        return r && r[key] && String(r[key]).indexOf(today) === 0;
      }).length;
    }
    return {
      dateText: (now.getMonth() + 1) + '月' + now.getDate() + '日',
      weekday: weekday,
      festival: festival,
      babyName: babyName,
      hasBaby: !!baby,
      ageText: ageText,
      preterm: preterm,
      hasPhoto: !!photoDataURL,
      photoDataURL: photoDataURL,
      feeding: cnt(d.feedings, 'start'),
      diaper: cnt(d.diapers, 'time'),
      sleep: cnt(d.sleeps, 'start')
    };
  }

  /* 浏览器内才调用：原生 canvas 画一张 1080×1440（3:4）分享卡片，
     绘完回调 { ok, dataURL, blob, data }。照片异步加载，故回调可能在异步后触发。 */
  function renderShareCard(d, cb) {
    cb = cb || function () {};
    try {
      if (!global.document || !document.createElement) { cb({ ok: false, error: 'no-document' }); return; }
      var data = buildShareCardData(d);
      var W = 1080, H = 1440;
      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      if (!ctx) { cb({ ok: false, error: 'no-context', data: data }); return; }

      var FONT = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

      function rr(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
      }

      /* 背景：奶油 → 柔青渐变 */
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#FFF7EF');
      g.addColorStop(1, '#E7F2EE');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      /* 顶栏：品牌（左） + 日期（右） */
      ctx.fillStyle = '#3E9B92';
      ctx.beginPath(); ctx.arc(74, 84, 17, 0, Math.PI * 2); ctx.fill();
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2F2A26';
      ctx.font = '600 36px ' + FONT;
      ctx.textAlign = 'left';
      ctx.fillText('咿呀记', 106, 84);
      ctx.fillStyle = '#7A726B';
      ctx.font = '500 34px ' + FONT;
      ctx.textAlign = 'right';
      ctx.fillText(data.dateText, W - 74, 84);
      ctx.textAlign = 'left';

      var cx = W / 2, cy = 430, R = 195;

      function drawPhotoCircle(img) {
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath();
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = 'rgba(62,155,146,0.20)';
        ctx.shadowBlur = 44;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.clip();
        if (img) {
          var side = Math.min(img.width, img.height);
          var sx = (img.width - side) / 2, sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, cx - R, cy - R, R * 2, R * 2);
        } else {
          ctx.fillStyle = '#F1EBE3';
          ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
          ctx.fillStyle = '#3E9B92';
          ctx.font = '700 150px ' + FONT;
          ctx.textAlign = 'center';
          ctx.fillText((data.babyName || '宝').charAt(0), cx, cy + 12);
          ctx.textAlign = 'left';
        }
        ctx.restore();
      }

      function drawRest() {
        /* 宝宝名 + 月龄 */
        ctx.textAlign = 'center';
        ctx.fillStyle = '#2F2A26';
        ctx.font = '700 62px ' + FONT;
        ctx.fillText(data.babyName || '宝宝', cx, cy + R + 74);
        ctx.fillStyle = '#7A726B';
        ctx.font = '500 38px ' + FONT;
        ctx.fillText('宝宝 · ' + data.ageText + (data.preterm ? ' · 早产' : ''), cx, cy + R + 130);
        ctx.textAlign = 'left';

        /* 今日三统计丸 */
        var pills = [
          { label: '今日喂养', value: data.feeding + ' 次' },
          { label: '今日尿布', value: data.diaper + ' 次' },
          { label: '今日睡眠', value: data.sleep + ' 段' }
        ];
        var pillW = 282, pillH = 172, gap = 28;
        var startX = (W - (pillW * 3 + gap * 2)) / 2;
        var py = cy + R + 196;
        pills.forEach(function (p, i) {
          var px = startX + i * (pillW + gap);
          ctx.fillStyle = '#FFFFFF';
          rr(px, py, pillW, pillH, 36); ctx.fill();
          ctx.fillStyle = '#3E9B92';
          ctx.font = '700 62px ' + FONT;
          ctx.textAlign = 'center';
          ctx.fillText(p.value, px + pillW / 2, py + 80);
          ctx.fillStyle = '#8A827B';
          ctx.font = '500 30px ' + FONT;
          ctx.fillText(p.label, px + pillW / 2, py + 132);
        });
        ctx.textAlign = 'left';

        /* 大日期 + 节日 */
        var dy = py + pillH + 132;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#2F2A26';
        ctx.font = '700 74px ' + FONT;
        ctx.fillText(data.dateText + ' ' + data.weekday, cx, dy);
        if (data.festival) {
          ctx.fillStyle = '#E8917F';
          ctx.font = '600 46px ' + FONT;
          ctx.fillText('· ' + data.festival + ' ·', cx, dy + 84);
        }
        ctx.textAlign = 'left';

        /* 页脚品牌落款 */
        ctx.fillStyle = '#A89F97';
        ctx.font = '500 30px ' + FONT;
        ctx.textAlign = 'center';
        ctx.fillText('本地记录 · 数据不出本机', cx, H - 86);
        ctx.textAlign = 'left';

        var dataURL = cv.toDataURL('image/png');
        if (cv.toBlob) {
          cv.toBlob(function (blob) {
            cb({ ok: true, dataURL: dataURL, blob: blob, data: data });
          }, 'image/png');
        } else {
          cb({ ok: true, dataURL: dataURL, blob: null, data: data });
        }
      }

      if (data.hasPhoto && data.photoDataURL) {
        var img = new Image();
        img.onload = function () { drawPhotoCircle(img); drawRest(); };
        img.onerror = function () { drawPhotoCircle(null); drawRest(); };
        img.src = data.photoDataURL;
      } else {
        drawPhotoCircle(null);
        drawRest();
      }
    } catch (e) {
      cb({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  /* 浏览器内：把图片下载到本机（相册/下载目录）。优先用 blob，不可用时回落 dataURL。 */
  function savePngBlob(blob, dataURL, name) {
    var url = blob ? URL.createObjectURL(blob) : dataURL;
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    if (blob) setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
  }

  /* 浏览器内：优先系统分享（图片文件），无能力则回落保存。 */
  function sharePngBlob(blob, dataURL, name) {
    try {
      var file = (blob) ? new File([blob], name, { type: 'image/png' }) : null;
      if (global.navigator && file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: '宝宝的今天', text: '今天的小记录' }).catch(function () {
          savePngBlob(blob, dataURL, name);
        });
      } else if (global.navigator && typeof navigator.share === 'function') {
        navigator.share({ title: '宝宝的今天', text: '今天的小记录' }).catch(function () {
          savePngBlob(blob, dataURL, name);
        });
      } else {
        savePngBlob(blob, dataURL, name);
        if (Util.toast) Util.toast('当前环境不支持直接分享，已为你保存为图片', 'info');
      }
    } catch (e) {
      savePngBlob(blob, dataURL, name);
    }
  }

  /* 浏览器内：分享卡片预览弹层（图片 + 分享/保存）。 */
  function openShareCardPreview(root, res) {
    var name = '咿呀记分享卡片_' + Util.todayISO() + '.png';
    root.innerHTML =
      '<div class="modal-mask" data-sc-mask>' +
        '<div class="modal share-card-modal" role="dialog" aria-modal="true" aria-label="分享卡片预览">' +
          '<h2>分享卡片</h2>' +
          '<div class="share-card-preview"><img src="' + res.dataURL + '" alt="分享卡片预览"></div>' +
          '<p class="hint">这是一张由本机生成的图片：可直接分享给家人，或存到相册。照片与记录不会上传任何服务器。</p>' +
          '<div class="modal-actions">' +
            '<button type="button" class="btn" data-sc-save>保存图片</button>' +
            '<button type="button" class="btn btn-primary" data-sc-share>分享</button>' +
          '</div>' +
          '<button type="button" class="btn btn-mini" data-sc-close style="width:100%;margin-top:8px">关闭</button>' +
        '</div></div>';
    var mask = root.querySelector('[data-sc-mask]');
    if (mask) mask.addEventListener('click', function (e) { if (e.target === mask) root.innerHTML = ''; });
    var closeBtn = root.querySelector('[data-sc-close]');
    if (closeBtn) closeBtn.addEventListener('click', function () { root.innerHTML = ''; });
    var saveBtn = root.querySelector('[data-sc-save]');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      savePngBlob(res.blob, res.dataURL, name);
      if (Util.toast) Util.toast('已保存为图片，可到相册/下载查看', 'ok');
    });
    var shareBtn = root.querySelector('[data-sc-share]');
    if (shareBtn) shareBtn.addEventListener('click', function () {
      sharePngBlob(res.blob, res.dataURL, name);
    });
  }

  var _sgCur = null, _sgY = 0; /* 第 182 次：当前打开的设置分组（跨 silent 重绘保持） */
  Modules.settings = {
    id: 'settings',
    title: '设置',
    render: function (view) {
      var s = Storage.get();
      var html = '';
      html += '<div class="page-head"><h1>设置</h1></div>';
      /* 第 59 次（二级菜单）：设置项按场景分成六组，<details> 折叠——
         一级只看分组目录，点开才进二级内容。内容保留在 DOM 里，
         无障碍与「Ctrl+F 找设置」不受影响。 */
      function sgOpen(iconKey, title, desc) {
        return '<details class="set-group"><summary>'
          + '<span class="sg-ico">' + icon(iconKey) + '</span>'
          + '<span class="sg-txt"><b>' + title + '</b><i>' + desc + '</i></span>'
          + '<span class="sg-chv" aria-hidden="true">' + icon('chevron-right') + '</span>'
          + '</summary>';
      }

      html += sgOpen('export', '数据与备份', '导出 / 导入 / CSV / 打印报告');
      html += '<div class="card"><h2>数据备份（唯一兜底手段）</h2>';
      /* 上次备份时间：纯本地应用的生命线提示 */
      var last = s.settings.lastExportISO;
      var backupInfo = last ? ('上次备份：' + last) : '还没有备份过数据';
      html += '<p class="hint">' + Util.escapeHtml(backupInfo) + (last ? '' : '，强烈建议现在导出一次。') + '</p>';
      /* 第 142 次：备份提醒从首页搬到这里（用户反馈「别放首页」）。
         阈值与文案由 Reminders.backupHint 单点维护（>14 天才提示），
         设置页只负责呈现，不再复制一份判断。 */
      var bh = (global.Reminders && typeof Reminders.backupHint === 'function')
        ? Reminders.backupHint(s, Date.now()) : null;
      if (bh && bh.text) {
        html += '<p class="hint backfill-note">' + Util.escapeHtml(bh.text) + ' 导出一次只需几秒，文件存在手机里就是兜底。</p>';
      }
      /* 第 74 次（G1）：损坏自愈备份的常驻状态行——启动 toast 只弹一次，这里保证长期可见。
         只展示、不给删除入口：误删备份等于烧掉唯一的找回通道，需要时由交接人手工处理。 */
      var cbInfo = Storage.corruptBackupInfo ? Storage.corruptBackupInfo() : null;
      if (cbInfo && cbInfo.exists) {
        html += '<p class="hint backfill-note">检测到一次历史数据损坏的原文备份（仅存本机，约 '
          + Math.max(1, Math.round(cbInfo.chars / 1024)) + ' KB）。当前数据正常时它不参与任何功能；'
          + '如怀疑旧记录丢失，可从这份备份中人工找回。</p>';
      }
      html += '<button class="btn btn-primary" id="sExport">导出全部数据（JSON · 可迁移）</button>';
      html += '<p class="hint">完整备份，可在任何设备导入恢复——换机或交接前请先导出。</p>';
      html += '<p class="hint">导出文件是明文，含敏感健康数据：只放你信任的位置，'
        + '别放公共目录或自动同步云端的文件夹；这里不提供加密——'
        + '无账号体系下加密密码一旦忘记，等于又丢一次数据。</p>';
      /* 第 66 次（F 线 F5）：情绪随记属敏感数据的归属说明 */
      html += '<p class="hint">「妈妈情绪」的记录同属敏感健康数据，一并包含在导出文件里，请同样注意存放位置；'
        + '它只存在本机，没有任何统计或上报。</p>';
      html += '<button class="btn" id="sImport">导入备份（JSON）</button>';
      /* 第 127 次（安全 · 来源提示）：结构由 sanitize 收敛、字段已全渲染点转义，
         残余风险只剩「数据污染」——导入他人文件等于把对方内容写进本机记录。 */
      html += '<p class="hint">默认合并：只加本机没有的记录，先给你看会新增多少；需要时也可选整体覆盖。'
        + '请只导入你自己导出的备份文件——导入来路不明的文件会把对方的内容写进你的记录。</p>';
      /* 持久存储申请：可申请、可被浏览器拒绝、不构成保证（U-36） */
      html += '<hr class="sep">';
      html += '<p class="hint" id="sPersistInfo">浏览器持久存储：检测中…</p>';
      html += '<button class="btn" id="sPersist" type="button">申请浏览器持久存储</button>';
      html += '<p class="hint">iPhone/iPad 的 Safari 长期不打开可能清掉本地数据；这步只是「申请」，'
        + '浏览器可拒绝、不构成保证——可靠备份只有上面的导出。</p>';
      html += '<button class="btn btn-danger" id="sReset">清空全部数据</button>'
        + '<p class="hint">清空前确认框里可以直接「先导出备份」。</p></div>';

      /* CSV 导出（Excel 可读，带 BOM）+ 打印报告（儿保体检给医生看） */
      html += '<div class="card"><h2>导出与打印</h2>';
      html += '<div class="row"><select id="sCsvModule" aria-label="选择要导出 CSV 的模块" style="flex:1">'
        + '<option value="feedings">喂养记录</option><option value="sleeps">睡眠记录</option>'
        + '<option value="diapers">尿布记录</option><option value="meds">吃药/维D记录</option>'
        + '<option value="growth">生长记录</option><option value="milestones">里程碑</option>'
        + '<option value="vaccines">疫苗接种</option><option value="contractions">宫缩记录</option>'
        + '<option value="periods">经期记录</option><option value="finance">记账记录</option>'
        + '</select><button class="btn" id="sCsv">导出 CSV</button></div>';
      html += '<p class="hint">CSV 可用 Excel / WPS 直接打开，适合整理归档。</p>';
      html += '<button class="btn" id="sPrint">打印成长报告</button>';
      html += '<p class="hint">生成一页式汇总（宝宝信息、生长、疫苗、近期喂养/尿布统计），可直接打印或另存 PDF 带给医生。</p>';
      /* 第 71 次（C1）：就诊摘要——把本地记录拼成给医生看的一段文字。
         与打印报告互补：打印是版式化的「报告」，这个是随手可发微信的「文字」。 */
      html += '<button class="btn" id="sVisit">生成就诊摘要（文字版 · 可分享）</button>';
      html += '<p class="hint">把生长、疫苗、儿保体检、发育观察点、里程碑与近期日常拼成一段给医生看的文字：'
        + '能分享就直接调起系统分享，不行就复制 + 存成 txt。全部在本机拼装，不经任何网络。</p>';
      /* 第 83 次（C2）：数据分享照片卡片——把今日宝宝照片 + 喂养/尿布/睡眠小结 + 日期画成一张图片，
         可直接调起系统分享发给家人，或保存为 PNG 到相册。与打印报告/就诊摘要互补：那个是「文字」，这个是「图」。 */
      html += '<button class="btn" id="sShareCard">生成分享卡片（图片 · 可发微信/存相册）</button>';
      html += '<p class="hint">把今天的宝宝照片、喂养/尿布/睡眠小结与日期画成一张图片卡片：能分享就直接调起系统分享，'
        + '不行就保存为 PNG。全程在本机绘制，照片与记录不出这台设备。</p></div>';
      html += '</details>';

      html += sgOpen('grid', '数据与统计', '各模块记录数 / 日的起始 / 本机占用 / 记录成本自测');
      /* 数据统计：各模块记录数一目了然，导出前确认数据完整 */
      var stats = Storage.stats();
      html += '<div class="card"><h2>数据统计</h2><ul class="kv">';
      stats.forEach(function (t) {
        html += '<li data-accent="' + t.key + '"><b>' + t.count + '</b> 条 ' + t.name + '</li>';
      });
      html += '</ul>';
      /* U-34：本机占用如实展示（阈值是设计判断，报告未给上限，故只说不猜） */
      var usage = (typeof Storage.usage === 'function') ? Storage.usage() : null;
      if (usage) {
        html += '<p class="hint">本机存储占用约 <b>' + usage.pct + '%</b>'
          + (usage.nearLimit ? '，已接近浏览器上限——建议先导出备份，再删掉不需要的旧记录。' : '，还很宽裕。')
          + '（估算值，浏览器上限因机而异）</p>';
      }
      /* U-15：迁移快照如实展示，让「升级不丢数据」可核查 */
      if (typeof Storage.snapshotCount === 'function' && Storage.snapshotCount() > 0) {
        html += '<p class="hint">升级前快照：本机保留 ' + Storage.snapshotCount() + ' 份（仅用于版本升级失败时回滚）。</p>';
      }
      html += '</div>';

      /* 第 131 次（P1-a · 对标 Cali DailyCareRecapBuilder 的 dayStart）：
         「日起始时刻」——凌晨记的喂养算今天还是昨天，从此自己说了算。
         默认 0:00（公历日）与既有行为完全一致；选 6:00 后，睡眠的
         「昨夜」口径与喂养/尿布的「今日」口径重合，半夜喂奶不再
         一笔算今天、一笔算昨天。疫苗剂次/预产期等认公历日，不受影响。 */
      var DAY_STARTS = [['0', '0:00 公历日'], ['4', '4:00'], ['6', '6:00']];
      var curDs = String(Util.dayStartHour(s));
      html += '<div class="card"><h2>日的起始</h2>';
      html += '<span class="lbl-text">每天从几点开始算</span><div class="seg seg-wrap2" id="sDayStartSeg">'
        + DAY_STARTS.map(function (m) {
          return '<button type="button" class="seg-btn' + (curDs === m[0] ? ' active' : '') + '" data-day-start="' + m[0] + '">' + m[1] + '</button>';
        }).join('')
        + '</div>';
      html += '<p class="hint">决定「今日 / 昨夜」从几点算起：默认 0:00 就是公历日；'
        + '选 6:00 后，凌晨 0–6 点记的喂养和睡眠都归前一天——和「凌晨入睡算前一晚」的睡眠口径对齐，'
        + '半夜喂奶不会再一笔算今天、一笔算昨天。只改首页与各页的今日统计；'
        + '疫苗剂次、预产期、备份天数认公历日，不受影响。</p></div>';

      /* U-05：把「单次记录 ≤2 次点击、≤1 秒」做成可核查的验收指标，数据只在本机 */
      var m = (global.App && typeof App.metricsSummary === 'function') ? App.metricsSummary() : null;
      html += '<div class="card"><h2>记录成本（本机自测）</h2>';
      if (m) {
        html += '<p>共 ' + m.n + ' 次记录：平均 <b>' + m.avgClicks + '</b> 次点击、<b>' + m.avgMs + '</b> 毫秒完成，' +
          '达标率（≤2 次点击且 ≤1 秒）<b>' + m.passRate + '%</b>。</p>';
        html += '<ul class="kv">';
        m.recent.forEach(function (r) {
          var name = (Modules[r.mod] && Modules[r.mod].title) || r.mod;
          html += '<li>' + Util.escapeHtml(name) + '：' + r.clicks + ' 次点击 / ' + r.ms + ' 毫秒 '
            + (r.pass ? '达标' : '未达标') + '</li>';
        });
        html += '</ul>';
      } else {
        html += '<p class="hint">还没有样本。去记一笔喂养或睡眠，这里会显示点击次数与耗时。</p>';
      }
      html += '<p class="hint">这是验收线而不是体验目标：数据只存在本机，用于自己核对，不上报给任何人。</p></div>';
      html += '</details>';

      /* 第 71 次（B5/B6）：知识与来源——知识底座的出处与引用分层，全部数据来自 Knowledge */
      html += sgOpen('search', '知识与来源', '内容出处 / 引用分层');
      html += '<div class="card"><h2>知识来源</h2>';
      html += '<p class="hint">知识句与参考数字来自以下公开资料，按可信度分三级：'
        + '<b>官方标准/指南</b> &gt; <b>权威机构共识</b> &gt; <b>学派/流行观点</b>；'
        + '数据类只采用官方标准。只列出处，不替代产检或儿保，重要判断遵医嘱。</p>';
      html += '<ul class="kv">';
      var usedSrc = {};
      Knowledge.all().forEach(function (e) { usedSrc[e.source] = (usedSrc[e.source] || 0) + 1; });
      /* 观察点/预警条目不在 DATA 里，按官方出处分别计入 */
      Knowledge.MILESTONES.forEach(function (e) {
        var code = (e.kind === 'obs') ? 'GJ-2025' : 'YJZX';
        usedSrc[code] = (usedSrc[code] || 0) + 1;
      });
      Object.keys(Knowledge.SOURCES).forEach(function (code) {
        html += '<li><b>' + Util.escapeHtml(code) + '</b> ' + Util.escapeHtml(Knowledge.SOURCES[code])
          + ' <i>（引用 ' + (usedSrc[code] || 0) + ' 条）</i></li>';
      });
      html += '</ul>';
      html += '<p class="hint">知识按 WHO 养育照护框架五要素归类：健康 / 营养 / 回应性照护 / 安全 / 早期学习，'
        + '外加「妈妈情绪」一类。每条知识在本机内置、零联网；来源页本身也不收集任何数据。</p></div>';
      html += '</details>';

      html += sgOpen('bell', '提醒', '首页提醒卡 / 每周回顾');
      /* U-04：提醒开关。关掉不损失任何功能——提醒只是「注意」，不是功能。 */
      html += '<div class="card"><h2>提醒</h2>';
      html += '<div class="row-switch"><label for="sRemind">首页提醒卡</label>'
        + '<input type="checkbox" id="sRemind"' + (s.settings.remindersEnabled !== false ? ' checked' : '') + '></div>';
      html += '<p class="hint">关闭后，首页不再出现提醒卡。所有记录、导出与回顾功能完全不受影响。</p>';
      html += '<div class="row-switch"><label for="sReview">每周回顾提醒</label>'
        + '<input type="checkbox" id="sReview"' + (s.settings.weeklyReviewEnabled ? ' checked' : '') + '></div>';
      html += '<p class="hint">默认关闭。开启后每周最多一次，内容只是「摘要已生成」，不催你、不打卡、不提连续天数；'
        + '随时可以在「日期记录」页看到回顾，不需要靠提醒。</p></div>';
      html += '</details>';

      html += sgOpen('baby', '称呼与阶段', '宝宝档案 / 首页称呼 / 首次引导 / 当前阶段');
      /* 第 80 次（宝宝档案）：多宝宝家庭在这里添加/切换/改名/删照片。
         切换后 settings.baby（名字/生日）被镜像更新，growth/vaccine 等模块零改动跟随。 */
      html += '<div class="card"><h2>宝宝档案</h2>';
      var babies = s.babies || [];
      var actId = s.settings.activeBabyId;
      if (babies.length) {
        html += '<ul class="list baby-list" id="sBabyList">';
        babies.forEach(function (b) {
          var isAct = b.id === actId;
          var ava = b.photo ? ('<img class="baby-ava" src="' + Util.escapeHtml(b.photo) + '" alt="">')
            : '<span class="baby-ava baby-ava-fallback">' + icon('pregnancy') + '</span>';
          var sub = b.birthDate ? ('生日 ' + b.birthDate) : '未设置生日';
          html += '<li data-baby-id="' + Util.escapeHtml(b.id) + '" role="button" tabindex="0"'
            + (isAct ? ' data-baby-active="1"' : '') + '>'
            + ava
            + '<span class="li-main"><b>' + Util.escapeHtml(b.name) + '</b>'
            + '<i class="baby-sub">' + Util.escapeHtml(sub) + '</i></span>'
            + (isAct ? '<span class="baby-badge">当前</span>' : '')
            + '<span class="baby-ops">'
            + '<button type="button" class="btn-mini" data-baby-rename="' + Util.escapeHtml(b.id) + '">改名</button>'
            + '<button type="button" class="btn-mini" data-baby-photo="' + Util.escapeHtml(b.id) + '">照片</button>'
            + '<button type="button" class="btn-mini" data-baby-del="' + Util.escapeHtml(b.id) + '">删除</button>'
            + '</span></li>';
        });
        html += '</ul>';
      } else {
        html += '<p class="hint">还没有宝宝档案。点「添加宝宝」建一个——首页问候、疫苗、生长都会跟着生日走。</p>';
      }
      html += '<div class="row"><button class="btn btn-primary" id="sBabyAdd" type="button">添加宝宝</button>'
        + '<button class="btn" id="sBabyPhotoCur" type="button">给当前宝宝换照片</button></div>';
      html += '<p class="hint">点宝宝行即切换：头像、问候与疫苗/生长排期跟着换；照片只存本机。'
        + '喂养、睡眠、尿布、生长、疫苗等记录按宝宝分开保存；经期、孕期、情绪、记账等妈妈的记录全家共用。</p></div>';

      /* O 系列：称呼与身份。只影响首页问候语，不采集任何个人信息；随时可改、可重来，不阻塞功能。 */
      html += '<div class="card"><h2>称呼与引导</h2>';
      html += '<label>首页称呼（可留空）<input type="text" id="sCareName" maxlength="12" placeholder="比如：妈妈、豆豆妈、奶奶" value="'
        + Util.escapeHtml((s.settings.caregiver && s.settings.caregiver.name) || '') + '"></label>';
      var cgRole = (s.settings.caregiver && s.settings.caregiver.role) || '';
      var CARE_ROLES = [['', '不设置'], ['mom', '妈妈'], ['dad', '爸爸'], ['other', '其他照护者']];
      html += '<div class="seg seg-lg" id="sCareRole">';
      CARE_ROLES.forEach(function (p) {
        html += '<button type="button" class="seg-btn' + (cgRole === p[0] ? ' active' : '') + '" data-role="' + p[0] + '">' + p[1] + '</button>';
      });
      html += '</div>';
      html += '<p class="hint">只用来决定首页怎么称呼你。不做账号、不采集姓名手机号，没有任何数据离开这台设备。</p>';
      html += '<button class="btn" id="sReOnboard" type="button">重新开始首次引导</button>';
      html += '<p class="hint">重新走一遍引导（身份 → 阶段 → 详情 → 数据风险说明）。已有记录不受影响、不会被覆盖。</p></div>';

  /* 阶段切换（第 43 次）：引导里选的阶段可以随时改，且不锁死任何功能。
     优先级 settings.stage（显式选择）> 客观数据；这里显示的是实际生效值。 */
  var effStage = (global.App && typeof App.stageOf === 'function') ? App.stageOf(s)
    : ((((s.pregnancy || {}).lmp) ? 'pregnancy' : 'baby'));
  html += '<div class="card"><h2>当前阶段</h2>';
  html += '<span class="lbl-text">我现在处于</span><div class="seg seg-wrap2" id="sStageSeg">'
    + '<button type="button" class="seg-btn' + (effStage === 'pregnancy' ? ' active' : '') + '" data-stage-set="pregnancy">孕期中</button>'
    + '<button type="button" class="seg-btn' + (effStage === 'baby' ? ' active' : '') + '" data-stage-set="baby">宝宝已出生</button>'
    + '</div>';
  html += '<div class="row-switch"><label for="sTileFilter">磁贴只看当前阶段</label>' +
    '<input type="checkbox" id="sTileFilter"' + (s.settings.tilesByStage !== false ? ' checked' : '') + '></div>';
  html += '<p class="hint">开启后首页只显示当前阶段的模块（计时中的磁贴不受影响、始终显示）；'
    + '阶段由预产期/宝宝生日自动判定，这里可覆盖。</p></div>';
      html += '</details>';

      html += sgOpen('sun', '外观', '主题 / 玻璃折射 / 触感 / 天空时刻预览');
      /* 主题四选（第 40 次移除顶栏按钮；第 41 次加「跟随系统」）：这里是唯一主题入口 */
      html += '<div class="card">';
      var MODES = [['time', '跟随时间'], ['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']];
      var curMode = (s.settings.themeMode) || ((s.settings.themeAuto !== false) ? 'time' : (s.settings.theme === 'dark' ? 'dark' : 'light'));
      /* 第 118 次（外观区对标 Cali「外观」页）：文字 seg 换成微缩 UI 预览卡——
         每张卡用几个 <i> 画出「彩色 chips + 条 + 行」的极简缩样，底色与 chips
         的彩色/灰阶由 theme-card--X 修饰类在 CSS 侧区分（此处只输出类名与结构，
         不写任何样式）。仍保留 data-theme-mode，交互与 App.setTheme 不变；
         active / aria-pressed 由 curMode 在同一处算出，render 后天然同步。 */
      html += '<span class="lbl-text">主题</span><div class="theme-cards" id="sThemeSeg">'
        + MODES.map(function (m) {
          var act = (curMode === m[0]);
          return '<button type="button" class="theme-card theme-card--' + m[0] + (act ? ' active' : '') + '" data-theme-mode="' + m[0] + '" aria-pressed="' + (act ? 'true' : 'false') + '">'
            + '<span class="tc-view">'
            + '<i class="tc-chip"></i><i class="tc-chip"></i><i class="tc-chip"></i>'
            + '<i class="tc-bar"></i><i class="tc-line"></i>'
            + '</span>'
            + '<span class="tc-name">' + m[1] + '</span>'
            + '</button>';
        }).join('')
        + '</div>';
      html += '<p class="hint">「跟随时间」= 本地 22:00–06:00 自动暗色并压低动效；「跟随系统」跟设备设置。'
        + '手动选定后以你的选择为准。</p>';
      /* 第 103 次（OP-GAP-03）：字号三档。与主题同一个 seg 组件，形态一致。 */
      var FSCALES = [['normal', '标准'], ['lg', '大'], ['xl', '特大']];
      var curFs = (global.App && global.App.fontScale) ? global.App.fontScale() : (s.settings.fontScale || 'normal');
      if (FSCALES.map(function (m) { return m[0]; }).indexOf(curFs) < 0) curFs = 'normal';
      html += '<span class="lbl-text">字号</span><div class="seg font-seg" id="sFontSeg">'
        + FSCALES.map(function (m) {
          return '<button type="button" class="seg-btn' + (curFs === m[0] ? ' active' : '') + '" data-font-scale="' + m[0] + '">' + m[1] + '</button>';
        }).join('')
        + '</div>';
      html += '<p class="hint">调大后全站文字一起放大（含记录明细与提示文字），方便和家里长辈一起看。只改显示，不动任何记录。</p>';
      /* 第 118 次：字号样张——用当前档位实时显示「大数字 + 正文」两行，直接暴露
         「display 与 body 同比例放大（比例没被改善）」这个已知缺陷（CSS 侧正在解耦，
         这行正好把它可视化出来）。全部走 var(--fs-display) / var(--fs-body)，不写死 px。 */
      html += '<div class="fs-sample">'
        + '<span class="fss-display">28</span>'
        + '<span class="fss-body">宝宝今天喝得很好，这是正文的样子</span>'
        + '</div>';
      /* 第 118 次：高对比模式（opt-in）——给卡片加一圈更明显的描边、并把模块淡色底提亮，
         面向色觉障碍 / 老年晶状体黄化；读写走 App.hcMode() / App.setHcMode()（缺则回落关）。 */
      var hcOn = (global.App && typeof global.App.hcMode === 'function') ? global.App.hcMode() : false;
      html += '<div class="row-switch"><label for="sHcMode">高对比模式</label>'
        + '<input type="checkbox" id="sHcMode"' + (hcOn ? ' checked' : '') + '></div>';
      html += '<p class="hint">开启后给卡片加一圈更明显的描边、并把模块淡色底提亮，'
        + '让它在色觉障碍或老年晶状体黄化下也能分清。给别人用、或觉得界面“太素”时可关掉。</p>';
      /* 第 118 次：首页只显示常用（默认开）——落盘 settings.homeConverge 后重渲染，
         首页据此只留当前阶段最常用模块，其余收进「全部功能」。 */
      var convOn = s.settings.homeConverge !== false;
      html += '<div class="row-switch"><label for="sHomeConverge">首页只显示常用</label>'
        + '<input type="checkbox" id="sHomeConverge"' + (convOn ? ' checked' : '') + '></div>';
      html += '<p class="hint">开启后首页只留当前阶段最常用的几个模块，其余全部收进首页底部的「全部功能」；'
        + '没记过的模块不再占位。关掉就恢复全部磁贴。</p>';
      html += '<div class="row-switch"><label for="sRefract">真实玻璃折射</label>' +
        '<input type="checkbox" id="sRefract"' + (s.settings.realRefraction !== false ? ' checked' : '') + '></div>';
      html += '<p class="hint">开启后，玻璃卡片会折射背后的背景（更逼真的液态玻璃）。低端设备若出现卡顿可关闭。</p>';
      /* 第 45 次：保存触感反馈。默认开启；关掉只少一层手感反馈，不影响任何功能。 */
      html += '<div class="row-switch"><label for="sHaptic">保存时轻震一下</label>' +
        '<input type="checkbox" id="sHaptic"' + (s.settings.hapticEnabled !== false ? ' checked' : '') + '></div>';
      html += '<p class="hint">保存成功轻震一下、失败震两下。<b>仅安卓手机有效</b>：iPhone 的所有浏览器'
        + '都未实现网页震动，电脑无震动马达；不影响记录与保存。</p>';
      /* 第 100 次：底栏五口排列（取代第 87 次只镜像快记钮的「左手模式」开关）——
         left/right 时首页、日期记录、快记＋、宝宝切换、设置五口收进同侧竖排胶囊 */
      var HAND_OPTS = [['normal', '正常排列'], ['left', '左手模式'], ['right', '右手模式']];
      var curHand = (s.settings.handMode === 'left' || s.settings.handMode === 'right') ? s.settings.handMode : 'normal';
      html += '<span class="lbl-text">底栏排列</span><div class="seg seg-wrap2" id="sHandSeg">'
        + HAND_OPTS.map(function (m) {
          return '<button type="button" class="seg-btn' + (curHand === m[0] ? ' active' : '') + '" data-hand-mode="' + m[0] + '">' + m[1] + '</button>';
        }).join('')
        + '</div>';
      html += '<p class="hint">「左手 / 右手」把整条底栏竖起来贴在屏幕同侧（单手抱娃时拇指够得着），'
        + '按钮和「正常排列」完全一样，只是方向不同。</p>';
      /* 第 97 次：底栏右侧自定义快捷槽位——两页签之后加一个直达常用记录的入口 */
      var SLOT_OPTS = [
        ['', '不显示'], ['feeding', '喂养'], ['diaper', '尿布'], ['sleep', '睡眠'],
        ['contraction', '宫缩'], ['fetal', '胎动'], ['temp', '体温'], ['mood', '妈妈情绪']
      ];
      var curSlot = (s.settings.dockSlot != null) ? String(s.settings.dockSlot) : '';
      html += '<span class="lbl-text">底栏快捷入口</span><div class="seg seg-wrap2" id="sDockSlotSeg">'
        + SLOT_OPTS.map(function (m) {
          return '<button type="button" class="seg-btn' + (curSlot === m[0] ? ' active' : '') + '" data-dock-slot="' + m[0] + '">' + m[1] + '</button>';
        }).join('')
        + '</div>';
      html += '<p class="hint">在底部「首页 / 日期记录」右侧加一个常用记录的直达按钮，选「不显示」即恢复两页签。'
        + '正常排列与左手 / 右手模式都生效。</p>';
      /* 第 54 次：天空时刻预览——不用等到对应时段，点一下就看整页在一天里怎么变色
         （天空色板 + 全页环境光 + 日轮弧线三处同步）。会话级生效不落盘：刷新即回真实时间，
         不影响任何记录的时间戳（记录永远按真实时刻存）。 */
      var SKY_HOURS = [['real', '真实时间'], ['6.5', '清晨'], ['12.5', '正午'], ['18', '黄昏'], ['0', '深夜']];
      var pvHour = (global.Sky && Sky.previewHour != null) ? String(Sky.previewHour) : 'real';
      html += '<span class="lbl-text">天空时刻预览</span><div class="seg seg-wrap2" id="sSkyHourSeg">'
        + SKY_HOURS.map(function (m) {
          return '<button type="button" class="seg-btn' + (pvHour === m[0] ? ' active' : '') + '" data-sky-hour="' + m[0] + '">' + m[1] + '</button>';
        }).join('')
        + '</div>';
      html += '<p class="hint">走查设计效果用：切到「黄昏」再回首页，能看到暖金色浸满整页、太阳沉进地平线雾里。'
        + '只在当前页面会话内生效，刷新或关掉就回到真实时间。</p></div>';
      html += '</details>';

      html += sgOpen('heart', '关于与告别', '版本信息 / 能力边界 / 随时离开');

      html += '<div class="card"><h2>关于</h2>';
      html += '<p>咿呀记 Yiya v1.0 · 本地优先纯工具（2026-09）</p>';
      var swOn = false;
      try { swOn = !!(global.navigator && navigator.serviceWorker && navigator.serviceWorker.controller); } catch (e) {}
      html += '<p class="hint">运行环境：' + (swOn ? '已启用离线缓存（添加到主屏后可离线使用）' : '直接运行（未启用离线缓存，不影响使用）') + '。'
        + '无账号、无云、无广告、无社区、无推送。所有数据仅存本机浏览器。</p>';
      html += '<p class="hint">健康数据仅供参考，重要判断请遵医嘱。</p>';
      /* U-29 / U-32：能力边界要主动说，避免用户带着云产品的预期来用本地工具 */
      html += '<p class="hint">能力边界（先说清楚）：不提供实时家人共享、不提供多设备同步、不提供云端备份（U-29 / U-32）。'
        + '家人想看的时候，把导出的文件自己发过去；就医时用「打印成长报告」直接出示即可。</p></div>';

      /* U-03 体面退出四要素：阶段性总结视图 + 全量导出入口 + 告别式引导 + 不挽留。
         这条卡片的措辞是刻意的：不用「确定要走吗」这类话术，不设任何中断成本。 */
      html += '<div class="card farewell-card"><h2>用完了，随时可以走</h2>';
      html += '<p>这个工具本来就是陪你过一段路的：喂夜奶、哄睡、产检、记宫缩的那几个月。'
        + '如果你觉得已经不需要它了，那是好事，不用留在这里。</p>';
      html += '<p class="hint">走之前，你大概想要这三样东西：</p>';
      html += '<button class="btn" id="sReviewLink" type="button">看一眼阶段性回顾</button>';
      html += '<button class="btn btn-primary" id="sExport2" type="button">把全部数据带走（JSON）</button>';
      html += '<button class="btn" id="sPrint2" type="button">打印一页式成长报告</button>';
      html += '<p class="hint">这些都不需要注册、不需要付费、不需要再回来。这里没有会员墙，也不会多问你一句'
        + '「要不要再想想」——你的数据是你的，走的时候直接带走就好。</p></div>';
      html += '</details>';

      view.innerHTML = html;
      /* 第 182 次（用户：设置在一个页面里展开有点乱）：分组从「原地折叠展开」改为真正的二级页。
         一级页只剩分组目录；点一行 → 整页只显示这一组，大标题换成组名，底栏切成「返回 + ＋」，
         侧滑 / 系统返回 / 返回钮都回到目录（history 与转场由 App.enterSub 统一管理）。
         各组内容仍一次性渲染在 DOM 里，下面的事件绑定一行不用改；
         组内改设置触发 rerender（silent）时，按 _sgCur 原地回到同一组，不会被踢回目录。 */
      var sgHead = view.querySelector('.page-head h1');
      var sgGroups = view.querySelectorAll('.set-group');
      function sgShow(idx, push) {
        var g = sgGroups[idx];
        if (!g) return;
        _sgCur = idx;
        if (push) _sgY = window.pageYOffset || 0;
        g.open = true;
        g.classList.add('sg-cur');
        view.classList.add('sg-in');
        var b = g.querySelector('.sg-txt b');
        if (sgHead && b) sgHead.textContent = b.textContent;
        if (push) {
          try { window.scrollTo(0, 0); } catch (e) {}
          if (global.App && App.enterSub) App.enterSub(sgHide);
        }
      }
      function sgHide() {
        _sgCur = null;
        var cur = view.querySelector('.set-group.sg-cur');
        if (cur) { cur.classList.remove('sg-cur'); cur.open = false; }
        view.classList.remove('sg-in');
        if (sgHead) sgHead.textContent = '设置';
        var y = _sgY; _sgY = 0;
        try { window.scrollTo(0, y); } catch (e) {}
      }
      Array.prototype.forEach.call(sgGroups, function (g, i) {
        var sm = g.querySelector('summary');
        if (sm) sm.addEventListener('click', function (e) {
          e.preventDefault();
          if (view.classList.contains('sg-in')) return;
          sgShow(i, true);
        });
      });
      if (_sgCur != null && global.App && App.inSub && App.inSub()) {
        sgShow(_sgCur, false);
        App.enterSub(sgHide); /* 已在二级态：只换成新 DOM 的回调，不再多推一条 history */
      } else { _sgCur = null; }
      view.querySelector('#sExport').addEventListener('click', function () { global.App.exportAll(); });
      view.querySelector('#sImport').addEventListener('click', function () { global.App.importAll(); });
      view.querySelector('#sReset').addEventListener('click', function () { global.App.resetAll(); });
      /* ---- 第 71 次（C1）：就诊摘要——优先系统分享，无能力则复制 + 下载 txt ---- */
      view.querySelector('#sVisit').addEventListener('click', function () {
        var text = buildVisitSummary(Storage.get());
        function fallback() {
          var copied = false;
          try {
            if (global.navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
              navigator.clipboard.writeText(text).then(function () {}, function () {});
              copied = true;
            }
          } catch (e) { /* 剪贴板不可用不影响下载 */ }
          try {
            var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = '就诊摘要_' + Util.todayISO() + '.txt';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
            Util.toast(copied ? '摘要已复制并下载为 txt' : '摘要已下载为 txt，可直接带给医生', 'ok');
          } catch (e) { Util.toast('生成失败，请重试', 'error'); }
        }
        if (global.navigator && typeof navigator.share === 'function') {
          navigator.share({ title: '就诊摘要', text: text }).catch(fallback);
        } else fallback();
      });
      /* 第 83 次（C2）：分享卡片入口——生成图片 → 预览弹层（分享/保存 PNG） */
      view.querySelector('#sShareCard').addEventListener('click', function () {
        var root = document.getElementById('modalRoot');
        if (!root) return;
        if (Util.toast) Util.toast('正在生成卡片…', 'info');
        renderShareCard(Storage.get(), function (res) {
          if (!res || !res.ok || !res.dataURL) {
            if (Util.toast) Util.toast('生成失败，请重试', 'error');
            return;
          }
          openShareCardPreview(root, res);
        });
      });
      /* ---- 浏览器持久存储：如实展示「已授予 / 未授予 / 浏览器不支持」 ---- */
      var persistInfo = view.querySelector('#sPersistInfo');
      var persistBtn = view.querySelector('#sPersist');
      function setPersistInfo(text) { if (persistInfo) persistInfo.textContent = '浏览器持久存储：' + text; }
      if (!global.navigator || !navigator.storage || typeof navigator.storage.persisted !== 'function') {
        setPersistInfo('当前浏览器不支持申请（不影响导出备份）');
        if (persistBtn) persistBtn.disabled = true;
      } else {
        navigator.storage.persisted().then(function (ok) {
          setPersistInfo(ok ? '已授予' : '未授予');
          if (persistBtn) persistBtn.disabled = !!ok;
        }).catch(function () { setPersistInfo('状态未知，可尝试申请'); });
        if (persistBtn) persistBtn.addEventListener('click', function () {
          if (!navigator.storage.persist) { setPersistInfo('当前浏览器不支持申请（不影响导出备份）'); return; }
          persistBtn.disabled = true;
          persistBtn.textContent = '申请中…';
          navigator.storage.persist().then(function (ok) {
            setPersistInfo(ok ? '已授予' : '浏览器未授予；请继续定期导出');
            if (!ok) { persistBtn.disabled = false; persistBtn.textContent = '申请浏览器持久存储'; }
          }).catch(function () {
            setPersistInfo('申请失败或不可用；请继续定期导出');
            persistBtn.disabled = false;
            persistBtn.textContent = '申请浏览器持久存储';
          });
        });
      }

      /* U-04 提醒开关：写入设置即刻生效，不做二次确认（关提醒不是破坏性操作） */
      var remSwitch = view.querySelector('#sRemind');
      if (remSwitch) remSwitch.addEventListener('change', function () {
        var st = Storage.get();
        st.settings.remindersEnabled = remSwitch.checked;
        Storage.save();
        Util.toast(remSwitch.checked ? '已开启首页提醒卡' : '已关闭首页提醒卡（功能不受影响）', 'ok');
      });
      var revSwitch = view.querySelector('#sReview');
      if (revSwitch) revSwitch.addEventListener('change', function () {
        var st = Storage.get();
        st.settings.weeklyReviewEnabled = revSwitch.checked;
        if (revSwitch.checked) st.settings.lastReviewISO = Util.todayISO(); /* 从今天起算，不搞「补发」 */
        Storage.save();
        Util.toast(revSwitch.checked ? '已开启每周回顾提醒（每周最多一次）' : '已关闭每周回顾提醒', 'ok');
      });

      /* O 系列：称呼 / 身份即时保存（只影响问候语，不是破坏性操作，不做二次确认） */
      /* 第 80 次（宝宝档案）：切换 / 添加 / 改名 / 照片 / 删除。全走 Storage 宝宝 API，
         落盘后刷新左上角头像并重绘设置页；首页在下次回到时自然拿到新档案。 */
      var babyList = view.querySelector('#sBabyList');
      if (babyList) babyList.addEventListener('click', function (ev) {
        var t = ev.target;
        var renameId = t.getAttribute ? t.getAttribute('data-baby-rename') : null;
        var photoId = t.getAttribute ? t.getAttribute('data-baby-photo') : null;
        var delId = t.getAttribute ? t.getAttribute('data-baby-del') : null;
        if (renameId) {
          var cur = (Storage.get().babies.filter(function (x) { return x.id === renameId; })[0] || {}).name || '';
          Util.editText({
            title: '宝宝称呼', value: cur, placeholder: '比如：豆豆、二宝', maxlength: 12, okText: '保存',
            onConfirm: function (v) {
              Storage.renameBaby(renameId, v);
              if (global.App.refreshHeaderAvatar) global.App.refreshHeaderAvatar();
              global.App.rerender();
              Util.toast('已改名', 'ok');
            }
          });
          return;
        }
        if (photoId) {
          Util.pickPhoto(function (dataURL) {
            if (!dataURL) return;
            if (photoId === Storage.get().settings.activeBabyId) {
              Storage.setActiveBabyPhoto(dataURL);
            } else {
              /* 非当前宝宝：临时切过去存照片再切回来（switchBaby 会镜像字段，
                 来回各切一次后镜像恢复原样，无净副作用） */
              var prev = Storage.get().settings.activeBabyId;
              Storage.switchBaby(photoId);
              Storage.setActiveBabyPhoto(dataURL);
              Storage.switchBaby(prev);
            }
            if (global.App.refreshHeaderAvatar) global.App.refreshHeaderAvatar();
            global.App.rerender();
            Util.toast('照片已保存（只在本机）', 'ok');
          });
          return;
        }
        if (delId) {
          var target = Storage.get().babies.filter(function (x) { return x.id === delId; })[0];
          Util.confirm({
            title: '删除「' + ((target && target.name) || '宝宝') + '」的档案？',
            /* 第 146 次：记录已按宝宝分开，删档案会连带删掉这个宝宝名下的记录——如实告知并给导出口。
               唯一的档案被删时记录保留（storage.removeBaby 同口径）。 */
            message: (Storage.get().babies.length > 1 && Storage.babyRecordCount(delId) > 0)
              ? '会同时删除这个宝宝名下的 ' + Storage.babyRecordCount(delId) + ' 条记录（喂养、睡眠、生长、疫苗等），删除后无法找回。'
              : '只删除档案本身，已有记录会保留。',
            okText: '删除',
            danger: true,
            extra: { text: '先导出备份', onClick: function () { global.App.exportAll(); } },
            onConfirm: function () {
              Storage.removeBaby(delId);
              if (global.App.refreshHeaderAvatar) global.App.refreshHeaderAvatar();
              global.App.rerender();
              Util.toast('已删除档案', 'ok');
            }
          });
          return;
        }
        /* 点行体 = 切换当前宝宝 */
        var li = t.closest ? t.closest('li[data-baby-id]') : null;
        if (li) {
          var b = Storage.switchBaby(li.getAttribute('data-baby-id'));
          if (b) {
            if (global.App.refreshHeaderAvatar) global.App.refreshHeaderAvatar();
            global.App.rerender();
            Util.toast('已切换到「' + b.name + '」', 'ok');
          }
        }
      });
      /* 添加宝宝：自建表单弹层（confirm 的 message 不接受 HTML，走 modal 基座） */
      var babyAdd = view.querySelector('#sBabyAdd');
      if (babyAdd) babyAdd.addEventListener('click', function () {
        var root = document.getElementById('modalRoot');
        if (!root) return;
        var draft = { name: '', birthDate: null, photo: null };
        root.innerHTML =
          '<div class="modal-mask" data-nb-mask>' +
            '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="nbTitle">' +
              '<h2 id="nbTitle">添加宝宝</h2>' +
              '<label>称呼（可留空）<input type="text" id="nbName" maxlength="12" placeholder="比如：豆豆、二宝"></label>' +
              '<label>生日（可先不填）<input type="date" id="nbBirth"></label>' +
              '<button type="button" class="btn" id="nbPhoto" style="width:100%;margin-right:0">选一张照片（可跳过）</button>' +
              '<p class="hint">照片在本机压缩到 288px 后保存，不会离开这台设备。</p>' +
              '<div class="modal-actions">' +
                '<button type="button" class="btn" data-nb-cancel>取消</button>' +
                '<button type="button" class="btn btn-primary" data-nb-ok>添加</button>' +
              '</div>' +
            '</div>' +
          '</div>';
        var mask = root.querySelector('[data-nb-mask]');
        var nbPhoto = root.querySelector('#nbPhoto');
        if (nbPhoto) nbPhoto.addEventListener('click', function () {
          Util.pickPhoto(function (dataURL) {
            if (!dataURL) return;
            draft.photo = dataURL;
            nbPhoto.textContent = '已选好照片 ✓';
          });
        });
        function close() { root.innerHTML = ''; }
        root.querySelector('[data-nb-cancel]').addEventListener('click', close);
        mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
        root.querySelector('[data-nb-ok]').addEventListener('click', function () {
          var nm = root.querySelector('#nbName');
          var bi = root.querySelector('#nbBirth');
          draft.name = nm ? nm.value.trim() : '';
          draft.birthDate = (bi && bi.value) ? bi.value : null;
          close();
          Storage.addBaby(draft);
          if (global.App.refreshHeaderAvatar) global.App.refreshHeaderAvatar();
          global.App.rerender();
          Util.toast('已添加并切换到「' + (draft.name || '宝宝') + '」', 'ok');
        });
        try { root.querySelector('#nbName').focus(); } catch (e) {}
      });
      var babyPhotoCur = view.querySelector('#sBabyPhotoCur');
      if (babyPhotoCur) babyPhotoCur.addEventListener('click', function () {
        if (!Storage.activeBaby()) { Util.toast('先添加一个宝宝档案', 'warn'); return; }
        Util.pickPhoto(function (dataURL) {
          if (!dataURL) return;
          Storage.setActiveBabyPhoto(dataURL);
          if (global.App.refreshHeaderAvatar) global.App.refreshHeaderAvatar();
          global.App.rerender();
          Util.toast('照片已保存（只在本机）', 'ok');
        });
      });

      var careName = view.querySelector('#sCareName');
      if (careName) careName.addEventListener('change', function () {
        var st = Storage.get();
        var c = st.settings.caregiver || { role: null, name: '' };
        c.name = careName.value.trim().slice(0, 12);
        st.settings.caregiver = (c.role || c.name) ? c : null;
        Storage.save();
        Util.toast('称呼已更新（回首页即可看到）', 'ok');
      });
      Array.prototype.forEach.call(view.querySelectorAll('#sCareRole [data-role]'), function (btn) {
        btn.addEventListener('click', function () {
          var st = Storage.get();
          var c = st.settings.caregiver || { role: null, name: '' };
          c.role = btn.getAttribute('data-role') || null;
          st.settings.caregiver = (c.role || c.name) ? c : null;
          Storage.save();
          Array.prototype.forEach.call(view.querySelectorAll('#sCareRole [data-role]'), function (x) { x.classList.remove('active'); });
          btn.classList.add('active');
          Util.toast('身份已更新', 'ok');
        });
      });
      var reOb = view.querySelector('#sReOnboard');
      if (reOb) reOb.addEventListener('click', function () {
        var st = Storage.get();
        st.settings.privacyAccepted = false; /* showOnboarding 以它为闸门 */
        st.settings.onboardingDone = false;
        Storage.save();
        if (global.App && global.App.startOnboarding) global.App.startOnboarding();
      });

      /* U-03 告别卡：回顾入口 / 带走数据 / 打印报告（复用设置页已有的打印实现，不复制代码） */
      var reviewLink = view.querySelector('#sReviewLink');
      if (reviewLink) reviewLink.addEventListener('click', function () { global.App.showTab('calendar'); });
      var export2 = view.querySelector('#sExport2');
      if (export2) export2.addEventListener('click', function () { global.App.exportAll(); });
      var print2 = view.querySelector('#sPrint2');
      if (print2) print2.addEventListener('click', function () {
        var origin = view.querySelector('#sPrint');
        if (origin) origin.click();
      });

      Array.prototype.forEach.call(view.querySelectorAll('#sThemeSeg [data-theme-mode]'), function (b) {
        b.addEventListener('click', function () {
          global.App.setTheme(b.getAttribute('data-theme-mode'));
          Util.toast('主题已切换：' + b.textContent, 'ok');
          global.App.rerender();
        });
      });

      /* 第 103 次（OP-GAP-03）：字号切换。刻意不 rerender 全页——
         setFontScale 已直接改 body 类，字号是纯视觉变化，重渲染反而会让用户
         在设置页看到整页闪一下。只更新 seg 的 active 态与提示 toast。 */
      Array.prototype.forEach.call(view.querySelectorAll('#sFontSeg [data-font-scale]'), function (b) {
        b.addEventListener('click', function () {
          var v = b.getAttribute('data-font-scale');
          global.App.setFontScale(v);
          /* 第 118 次：字号样张引用的 --fs-display / --fs-body 随 body 类变化，
             CSS 变量一改即刷新；沿用上面这套「回调里即时更新」的既有做法，
             再显式触发一次重排，保证样张与 seg 同步（不整页重渲染，避免闪屏）。 */
          var fsSample = view.querySelector('.fs-sample');
          if (fsSample) { void fsSample.offsetHeight; }
          Array.prototype.forEach.call(view.querySelectorAll('#sFontSeg .seg-btn'), function (x) {
            x.classList.remove('active');
          });
          b.classList.add('active');
          Util.toast('字号：' + b.textContent, 'ok');
        });
      });

      /* 第 54 次：天空时刻预览（会话级，不落盘）——只改视觉时刻，记录时间戳永远真实 */
      Array.prototype.forEach.call(view.querySelectorAll('#sSkyHourSeg [data-sky-hour]'), function (b) {
        b.addEventListener('click', function () {
          if (!global.Sky) return;
          var v = b.getAttribute('data-sky-hour');
          Sky.previewHour = (v === 'real') ? null : parseFloat(v);
          Util.toast(v === 'real' ? '已回到真实时间' : '已切到' + b.textContent + '——回首页看天空和整页底色', 'ok');
          global.App.rerender();
        });
      });

      /* 阶段切换（第 43 次）：即时生效，首页磁贴排序随之改变 */
      Array.prototype.forEach.call(view.querySelectorAll('#sStageSeg [data-stage-set]'), function (b) {
        b.addEventListener('click', function () {
          var st = b.getAttribute('data-stage-set');
          global.App.setStage(st);
          Util.toast('已切换到' + (st === 'pregnancy' ? '孕期' : '育儿期'), 'ok');
          global.App.rerender();
        });
      });

      /* 第 48 次：磁贴按阶段筛选开关（与阶段切换同一个卡，语义连贯） */
      var tf = view.querySelector('#sTileFilter');
      if (tf) tf.addEventListener('change', function () {
        var st = Storage.get();
        st.settings.tilesByStage = tf.checked;
        Storage.save();
        Util.toast(tf.checked ? '首页磁贴已按当前阶段筛选' : '已显示全部模块磁贴', 'ok');
        global.App.rerender();
      });

      /* 第 118 次：高对比开关——沿用 sRefract / sHaptic 同一套「取元素 + change」绑定，
         只调用 App.setHcMode（内部已负责写 Storage.save() 与切 body.hc 类）。 */
      var hc = view.querySelector('#sHcMode');
      if (hc) hc.addEventListener('change', function () {
        if (global.App && typeof global.App.setHcMode === 'function') global.App.setHcMode(hc.checked);
        Util.toast(hc.checked ? '已开启高对比模式' : '已关闭高对比模式', 'ok');
      });

      /* 第 118 次：首页只显示常用——落盘后重渲染，首页据此收敛磁贴（与 sTileFilter 同范式）。 */
      var conv = view.querySelector('#sHomeConverge');
      if (conv) conv.addEventListener('change', function () {
        var st = Storage.get();
        st.settings.homeConverge = conv.checked;
        Storage.save();
        Util.toast(conv.checked ? '首页只显示常用模块' : '首页恢复显示全部磁贴', 'ok');
        /* 第 119 次：补存在性守卫——上一行 setHcMode 的调用就是带守卫的，
           同一处理范式不应一条有守卫一条裸调（QA 沙箱缺 App 时会抛错）。 */
        if (global.App && typeof global.App.rerender === 'function') global.App.rerender();
      });

      /* 第 131 次（P1-a）：日起始时刻——落盘后重渲染，首页磁贴与各页「今日」
         统计随即按新口径归属（与 sHomeConverge 同范式：改完立刻看得见）。 */
      var dsSeg = view.querySelector('#sDayStartSeg');
      if (dsSeg) dsSeg.addEventListener('click', function (e) {
        var t = e.target;
        while (t && t !== dsSeg && !(t.getAttribute && t.getAttribute('data-day-start') != null)) t = t.parentNode;
        if (!t || t === dsSeg) return;
        var v = parseInt(t.getAttribute('data-day-start'), 10);
        if (isNaN(v)) return;
        var st = Storage.get();
        st.settings.dayStart = v;
        Storage.save();
        Array.prototype.forEach.call(dsSeg.querySelectorAll('.seg-btn'), function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        Util.toast(v === 0 ? '已按公历日计算今日' : '今日从 ' + v + ':00 开始算——凌晨的记录归前一天', 'ok');
        global.App.rerender();
      });

      var refr = view.querySelector('#sRefract');
      if (refr) refr.addEventListener('change', function () {
        var st = Storage.get();
        st.settings.realRefraction = refr.checked;
        Storage.save();
        if (global.Glass) global.Glass.setEnabled(refr.checked);
      });

      /* 第 45 次：保存触感开关。注意这里不要再手动震一次——上面的 Storage.save()
         在开关打开后已经震过了（震一次就够，连震两下反而像出故障）。 */
      var hap = view.querySelector('#sHaptic');
      if (hap) hap.addEventListener('change', function () {
        var st = Storage.get();
        st.settings.hapticEnabled = hap.checked;
        Storage.save();
        Util.toast(hap.checked ? '已开启保存震动（安卓手机才有实际效果）' : '已关闭保存震动', 'ok');
      });

      /* 第 100 次：底栏五口排列——落盘后走 applyTheme 挂类 + buildTabbar 重建，
         与主题同管道（幂等），切完即刻生效不用刷新 */
      var handSeg = view.querySelector('#sHandSeg');
      if (handSeg) handSeg.addEventListener('click', function (e) {
        var t = e.target;
        while (t && t !== handSeg && !(t.getAttribute && t.getAttribute('data-hand-mode'))) t = t.parentNode;
        if (!t || t === handSeg) return;
        var v = t.getAttribute('data-hand-mode');
        var st = Storage.get();
        st.settings.handMode = v;
        /* 第 119 次：删除了原「旧字段 leftHand 同步写」那行死代码。
           它是死写入：leftHand 不在 sanitize() 白名单里（storage.js 逐键白名单），
           save() 落盘后下次 load 就被丢掉；且全仓没有任何代码读这个字段——
           唯一引用是 storage.js 的「导入旧备份时把旧布尔值迁移为 handMode=left」，
           那是读外部数据，不是读这里的写入。原注释声称「只读旧字段的代码语义不破」
           并不成立。真实现役字段是上一行的 handMode（三值枚举）。 */
        Storage.save();
        if (global.App && typeof App.applyTheme === 'function') App.applyTheme();
        if (global.App && typeof App.buildTabbar === 'function') App.buildTabbar();
        Array.prototype.forEach.call(handSeg.querySelectorAll('.seg-btn'), function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        Util.toast(v === 'left' ? '已切左手模式：底栏竖排贴左侧'
          : v === 'right' ? '已切右手模式：底栏竖排贴右侧'
          : '已恢复正常排列', 'ok');
      });

      /* 第 97 次：底栏快捷入口选择——落盘后即时重建底栏（槽位显隐随选随生效） */
      var slotSeg = view.querySelector('#sDockSlotSeg');
      if (slotSeg) slotSeg.addEventListener('click', function (e) {
        var t = e.target;
        while (t && t !== slotSeg && !(t.getAttribute && t.getAttribute('data-dock-slot') != null)) t = t.parentNode;
        if (!t || t === slotSeg) return;
        var v = t.getAttribute('data-dock-slot');
        var st = Storage.get();
        st.settings.dockSlot = (v === '') ? null : v;
        Storage.save();
        Array.prototype.forEach.call(slotSeg.querySelectorAll('.seg-btn'), function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        if (global.App && typeof App.buildTabbar === 'function') App.buildTabbar();
        Util.toast(v === '' ? '已收起底栏快捷入口' : '底栏快捷入口已设为「' + (Modules[v] ? Modules[v].title : v) + '」', 'ok');
      });

      /* ---- CSV 导出（Excel/WPS 可读，带 BOM） ---- */
      function csvCell(v) {
        if (v == null) return '';
        v = String(v);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }
      function toCsv(header, rows) {
        var lines = [header.map(csvCell).join(',')];
        rows.forEach(function (r) { lines.push(r.map(csvCell).join(',')); });
        return '﻿' + lines.join('\r\n');
      }
      var FEED_T = { breast: '母乳', bottle: '奶瓶', solid: '辅食' };
      var SIDE_T = { left: '左', right: '右', both: '双侧' };
      var DIAPER_T = { pee: '尿', poop: '便', both: '尿+便' };
      var CSV_BUILDERS = {
        feedings: function (d) {
          return toCsv(['开始时间', '类型', '侧别', '时长(分)', '量(ml/g)', '备注'],
            (d.feedings || []).map(function (r) {
              return [r.start, FEED_T[r.type] || r.type, SIDE_T[r.side] || '', r.duration || '', r.amount || '', r.note];
            }));
        },
        sleeps: function (d) {
          return toCsv(['开始', '结束', '时长'], (d.sleeps || []).map(function (r) {
            return [r.start, r.end || '', r.end ? Util.fmtDuration(new Date(r.end) - new Date(r.start) - (r.pausedMs || 0)) : ''];
          }));
        },
        diapers: function (d) {
          return toCsv(['时间', '类型', '备注'], (d.diapers || []).map(function (r) {
            return [r.time, DIAPER_T[r.type] || r.type, r.note];
          }));
        },
        meds: function (d) {
          return toCsv(['时间', '名称', '备注'], (d.meds || []).map(function (r) { return [r.time, r.name, r.note]; }));
        },
        growth: function (d) {
          return toCsv(['日期', '体重(kg)', '身长(cm)', '头围(cm)'], (d.growth || []).map(function (r) {
            return [r.date, r.weightKg, r.heightCm, r.headCm];
          }));
        },
        milestones: function (d) {
          return toCsv(['日期', '里程碑', '备注'], (d.milestones || []).map(function (r) { return [r.date, r.title, r.note]; }));
        },
        vaccines: function (d) {
          var rows = [];
          var plan = (global.Modules && Modules.vaccine && typeof Modules.vaccine._plan === 'function'
            && d.settings.baby && d.settings.baby.birthDate) ? Modules.vaccine._plan(d.settings.baby.birthDate) : [];
          var done = (d.vaccines && d.vaccines.done) || {};
          plan.forEach(function (it) { rows.push([it.name + it.dose, it.dueISO, done[it.key] || '未接种']); });
          return toCsv(['疫苗剂次', '应种日期', '接种日期'], rows);
        },
        contractions: function (d) {
          return toCsv(['开始', '结束'], (d.contractions || []).map(function (r) { return [r.start, r.end || '']; }));
        },
        periods: function (d) {
          return toCsv(['开始', '结束'], (d.periods || []).map(function (r) { return [r.start, r.end || '']; }));
        },
        finance: function (d) {
          var recs = (d.finance && d.finance.records) || [];
          return toCsv(['日期', '类目', '金额', '备注'], recs.map(function (r) { return [r.date, r.category, r.amount, r.note]; }));
        }
      };
      view.querySelector('#sCsv').addEventListener('click', function () {
        var key = view.querySelector('#sCsvModule').value;
        var csv = CSV_BUILDERS[key](Storage.get());
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '咿呀记_' + key + '_' + Util.todayISO() + '.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        Util.toast('CSV 已导出', 'ok');
      });

      /* ---- 打印成长报告：新窗口生成一页式汇总并唤起打印 ---- */
      view.querySelector('#sPrint').addEventListener('click', function () {
        var d = Storage.get();
        var baby = (d.settings && d.settings.baby) || {};
        var w = global.open('', '_blank');
        if (!w) { Util.toast('浏览器拦截了弹窗，请允许后重试', 'error'); return; }
        /* 第 127 次（安全）：本页 HTML 走 w.document.write 拼装，凡来自记录/导入的字段
           必须先转义——sanitize 只校验记录「是对象」，不校验字段值，导入 crafted 备份
           即可把 <img onerror> 之类带进这一页（新窗口与主文档同源，可访问 opener）。 */
        var esc = Util.escapeHtml;
        var body = '<h1>宝宝成长报告</h1><p class="sub">咿呀记 · 生成于 ' + Util.nowLocal().slice(0, 16).replace('T', ' ') + '</p>';
        body += '<h2>宝宝信息</h2><p>性别：' + esc(baby.sex === 'girl' ? '女' : (baby.sex === 'boy' ? '男' : '未设置'))
          + ' ｜ 出生日期：' + esc(baby.birthDate || '未设置')
          + (baby.preterm ? ' ｜ 早产（孕 ' + esc(baby.birthGestWeeks || '?') + ' 周）' : '') + '</p>';
        var gr = (d.growth || []).slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
        body += '<h2>生长记录（' + gr.length + ' 次）</h2>';
        if (gr.length) {
          body += '<table><tr><th>日期</th><th>体重 kg</th><th>身长 cm</th><th>头围 cm</th></tr>';
          gr.forEach(function (r) {
            body += '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.weightKg || '') + '</td><td>' + esc(r.heightCm || '') + '</td><td>' + esc(r.headCm || '') + '</td></tr>';
          });
          body += '</table>';
        } else body += '<p>暂无记录</p>';
        if (global.Modules && Modules.vaccine && typeof Modules.vaccine._plan === 'function' && baby.birthDate) {
          var plan = Modules.vaccine._plan(baby.birthDate);
          var done = (d.vaccines && d.vaccines.done) || {};
          var doneN = plan.filter(function (it) { return done[it.key]; }).length;
          body += '<h2>疫苗接种（' + doneN + '/' + plan.length + ' 剂）</h2><table><tr><th>剂次</th><th>应种</th><th>接种日期</th></tr>';
          plan.forEach(function (it) {
            body += '<tr><td>' + esc(it.name) + esc(it.dose) + '</td><td>' + esc(it.dueISO) + '</td><td>' + esc(done[it.key] || '未接种') + '</td></tr>';
          });
          body += '</table>';
        }
        var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
        var feeds = (d.feedings || []).filter(function (r) { return r.start && new Date(r.start) >= cutoff; });
        var dias = (d.diapers || []).filter(function (r) { return r.time && new Date(r.time) >= cutoff; });
        body += '<h2>近 30 天日常</h2><p>喂养 ' + feeds.length + ' 次 ｜ 换尿布 ' + dias.length + ' 次</p>';
        /* 第 66 次（F 线 F4）：就诊摘要带情绪节——4 个官方筛查时点之外的连续自记数据 */
        var cut14 = new Date(); cut14.setDate(cut14.getDate() - 14);
        var MOOD_W = { 1: '很低落', 2: '有点低', 3: '一般', 4: '不错', 5: '很好' };
        var mood14 = (d.moods || []).filter(function (r) { return r.time && new Date(r.time) >= cut14; });
        body += '<h2>近 14 天情绪（妈妈自记，' + mood14.length + ' 次）</h2>';
        if (mood14.length) {
          var dist = [5, 4, 3, 2, 1].map(function (lv) {
            var n = mood14.filter(function (r) { return r.level === lv; }).length;
            return n ? (MOOD_W[lv] + ' ' + n + ' 次') : '';
          }).filter(Boolean).join(' ｜ ');
          body += '<p>' + dist + '</p>';
        } else body += '<p>暂无记录</p>';
        body += '<p class="sub">情绪记录为本人自述，仅供问诊参考，不构成筛查或诊断。</p>';
        body += '<p class="foot">本报告数据来自本地记录，仅供参考，具体请遵医嘱。</p>';
        w.document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>成长报告</title>'
          + '<style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;max-width:640px;margin:24px auto;padding:0 16px;color:#333}'
          + 'h1{font-size:22px}h2{font-size:15px;border-left:3px solid #4FA8A0;padding-left:8px;margin-top:20px}'
          + 'table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}'
          + '.sub,.foot{color:#888;font-size:12px}@media print{body{margin:0}}</style></head><body>' + body + '</body></html>');
        w.document.close();
        w.focus();
        /* 第 127 次：原先固定 300ms 唤起打印，数据量大 / 弱机上可能页面还没渲染完
           就弹打印框。改为等新窗口 load；若 readyState 已是 complete 则立即打，
           另留 800ms 兜底（极端情况下 load 不触发也不至于永远打不出来）。 */
        (function firePrint() {
          var fired = false;
          var go = function () {
            if (fired) return;
            fired = true;
            try { w.focus(); w.print(); } catch (e) {}
          };
          if (w.document.readyState === 'complete') { go(); return; }
          w.addEventListener('load', go);
          setTimeout(go, 800);
        })();
      });
    }
  };
  /* 第 71 次（C1）：摘要构建器供 QA 运行时直测（纯函数，无 DOM 依赖） */
  Modules.settings._visitSummary = buildVisitSummary;
  /* 第 83 次（C2）：分享卡片数据构建器供 QA 运行时直测（纯函数，无 DOM 依赖） */
  Modules.settings._shareCardData = buildShareCardData;
})(window);
