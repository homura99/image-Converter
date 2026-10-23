(() => {
  const $ = id => document.getElementById(id);
  const drop = $('drop'), picker = $('files'), grid = $('grid');
  let items = [], nextId = 1, busy = false;
  const mimeToExt = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/bmp':'bmp','image/x-icon':'ico'};
  const fmtBytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(2)} MB`;
  const setStatus = s => $('status').textContent = s;
  $('quality').addEventListener('input', () => $('qualityText').textContent = $('quality').value + '%');
  drop.addEventListener('click', () => picker.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); }});
  picker.addEventListener('change', e => { addFiles(e.target.files); picker.value = ''; });
  ['dragenter','dragover'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave','drop'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  $('convert').addEventListener('click', convertAll);
  $('clear').addEventListener('click', clearAll);
  $('downloadAll').addEventListener('click', downloadZip);

  function addFiles(fileList) {
    const incoming = [...fileList].filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif|ico|tiff?)$/i.test(f.name));
    if (!incoming.length) { setStatus('画像ファイルが見つかりませんでした。'); return; }
    for (const file of incoming) {
      const item = {id: nextId++, file, url:null, result:null, resultUrl:null, error:null, loading:true, name:file.name.replace(/\.[^.]+$/, '') || 'image'};
      items.push(item);
      initializeItem(item);
    }
    render();
    setStatus(`${incoming.length}件の画像を追加しました。読み込み中です…`);
  }

  async function initializeItem(item) {
    try {
      const isHeic = /\.(heic|heif)$/i.test(item.file.name) || /image\/hei[cf]/i.test(item.file.type);
      let source = item.file;
      if (isHeic) {
        if (!window.heic2any) throw new Error('HEIC/HEIFデコーダーを読み込めません。インターネット接続を確認してください。');
        source = await window.heic2any({blob:item.file, toType:'image/png'});
        if (Array.isArray(source)) source = source[0];
        if (!(source instanceof Blob)) throw new Error('HEIC/HEIF画像をデコードできませんでした。');
      }
      const url = URL.createObjectURL(source);
      if (!items.includes(item)) { URL.revokeObjectURL(url); return; }
      item.url = url;
      const image = await loadImage(url);
      item.width = image.naturalWidth; item.height = image.naturalHeight;
    } catch (e) {
      item.error = e.message || 'この画像形式をブラウザで読み込めません';
    } finally {
      item.loading = false;
      render();
    }
  }

  function render() {
    $('count').textContent = `${items.length}件`;
    $('downloadAll').disabled = !items.some(x => x.result) || busy;
    grid.replaceChildren();
    for (const item of items) {
      const card = document.createElement('article'); card.className = 'card';
      const preview = document.createElement('div'); preview.className = 'preview';
      if (item.resultUrl || item.url) {
        const img = document.createElement('img'); img.alt = item.file.name;
        img.src = item.resultUrl || item.url; preview.append(img);
      }
      const body = document.createElement('div'); body.className = 'card-body';
      const name = document.createElement('div'); name.className = 'filename'; name.textContent = item.file.name;
      const meta = document.createElement('div'); meta.className = 'meta';
      meta.textContent = item.width ? `${item.width} × ${item.height} px · ${fmtBytes(item.file.size)}` : fmtBytes(item.file.size);
      body.append(name, meta);
      if (item.result) {
        const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = `変換済み · ${fmtBytes(item.result.size)}`; body.append(badge);
      } else if (item.error) {
        const err = document.createElement('div'); err.className = 'meta'; err.textContent = item.error; body.append(err);
      }
      const actions = document.createElement('div'); actions.className = 'card-actions';
      if (item.result) {
        const dl = document.createElement('button'); dl.textContent = '保存'; dl.addEventListener('click', () => saveItem(item)); actions.append(dl);
      }
      const remove = document.createElement('button'); remove.className = 'secondary'; remove.textContent = '削除'; remove.addEventListener('click', () => removeItem(item.id)); actions.append(remove);
      body.append(actions); card.append(preview, body); grid.append(card);
    }
    $('convert').disabled = busy || !items.length || items.some(x => x.loading || !x.url);
    $('clear').disabled = busy;
  }

  function getDimensions(item) {
    let w = Math.max(1, Math.floor(Number($('width').value) || item.width || 1));
    let h = Math.max(1, Math.floor(Number($('height').value) || item.height || 1));
    const hasW = $('width').value.trim() !== '', hasH = $('height').value.trim() !== '';
    if ($('fit').value === 'contain') {
      if (hasW && !hasH) h = Math.max(1, Math.round(w * item.height / item.width));
      else if (!hasW && hasH) w = Math.max(1, Math.round(h * item.width / item.height));
      else if (hasW && hasH) {
        const ratio = Math.min(w / item.width, h / item.height);
        w = Math.max(1, Math.round(item.width * ratio)); h = Math.max(1, Math.round(item.height * ratio));
      }
    }
    const fmt = $('format').value;
    if (fmt === 'image/x-icon') {
      const scale = Math.min(1, 256 / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
    }
    if (w > 12000 || h > 12000 || w*h > 80000000) throw new Error('出力サイズが大きすぎます（最大8000万画素）');
    return [w,h];
  }

  function loadImage(url) {
    return new Promise((resolve,reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('画像を読み込めませんでした。形式が未対応の可能性があります。'));
      img.src = url;
    });
  }
  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('この形式への変換に失敗しました')), type, quality));
  }
  function writeU16(view, offset, value) { view.setUint16(offset, value, true); }
  function writeU32(view, offset, value) { view.setUint32(offset, value, true); }
  function toBmp(canvas) {
    const {width, height} = canvas;
    const rowSize = Math.ceil(width * 3 / 4) * 4;
    const pixelDataSize = rowSize * height;
    const buffer = new ArrayBuffer(54 + pixelDataSize);
    const view = new DataView(buffer);
    view.setUint8(0, 0x42); view.setUint8(1, 0x4d);
    writeU32(view, 2, buffer.byteLength); writeU32(view, 10, 54);
    writeU32(view, 14, 40); writeU32(view, 18, width); writeU32(view, 22, height);
    writeU16(view, 26, 1); writeU16(view, 28, 24);
    writeU32(view, 34, pixelDataSize);

    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    for (let y = 0; y < height; y++) {
      const sourceRow = y * width * 4;
      const targetRow = 54 + (height - 1 - y) * rowSize;
      for (let x = 0; x < width; x++) {
        const source = sourceRow + x * 4;
        const target = targetRow + x * 3;
        view.setUint8(target, pixels[source + 2]);
        view.setUint8(target + 1, pixels[source + 1]);
        view.setUint8(target + 2, pixels[source]);
      }
    }
    return new Blob([buffer], {type:'image/bmp'});
  }
  async function toIco(pngBlob, width, height) {
    if (width > 256 || height > 256) throw new Error('ICOは256×256px以下にしてください');
    const png = new Uint8Array(await pngBlob.arrayBuffer());
    const buffer = new ArrayBuffer(6 + 16 + png.length), view = new DataView(buffer);
    writeU16(view,0,0); writeU16(view,2,1); writeU16(view,4,1);
    view.setUint8(6, width === 256 ? 0 : width); view.setUint8(7, height === 256 ? 0 : height);
    view.setUint8(8,0); view.setUint8(9,0); writeU16(view,10,1); writeU16(view,12,32);
    writeU32(view,14,png.length); writeU32(view,18,22);
    new Uint8Array(buffer,22).set(png);
    return new Blob([buffer], {type:'image/x-icon'});
  }
  async function convertOne(item) {
    if (!item.width || !item.height) {
      const source = await loadImage(item.url); item.width = source.naturalWidth; item.height = source.naturalHeight;
    }
    const [w,h] = getDimensions(item);
    const img = await loadImage(item.url);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', {alpha:true});
    const fmt = $('format').value;
    if ((fmt === 'image/jpeg' || fmt === 'image/bmp') && $('whiteBg').checked) { ctx.fillStyle = '#fff'; ctx.fillRect(0,0,w,h); }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img,0,0,w,h);
    let blob;
    if (fmt === 'image/x-icon') {
      const png = await canvasBlob(canvas,'image/png');
      blob = await toIco(png,w,h);
    } else if (fmt === 'image/bmp') {
      blob = toBmp(canvas);
    } else {
      blob = await canvasBlob(canvas,fmt,Number($('quality').value)/100);
      if (blob.type !== fmt) throw new Error(`${fmt}形式に対応していないブラウザです`);
    }
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    item.result = blob; item.resultUrl = URL.createObjectURL(blob); item.error = null;
    item.outputName = `${item.name}.${mimeToExt[fmt]}`;
  }
  async function convertAll() {
    if (busy || !items.length || items.some(x => x.loading || !x.url)) return;
    busy = true; render();
    let done = 0, failed = 0;
    for (const item of items) {
      try { await convertOne(item); done++; }
      catch (e) { item.error = e.message || '変換に失敗しました'; failed++; }
      setStatus(`変換中… ${done + failed}/${items.length}件`);
      render();
    }
    busy = false; render();
    setStatus(`変換完了：成功 ${done}件、失敗 ${failed}件。`);
  }
  function saveItem(item) {
    if (!item.result) return;
    const a = document.createElement('a'); a.href = item.resultUrl; a.download = item.outputName;
    document.body.append(a); a.click(); a.remove();
  }
  async function downloadZip() {
    const ready = items.filter(x => x.result);
    if (!ready.length) return;
    if (!window.JSZip) { setStatus('ZIPライブラリを読み込めません。各画像の「保存」を使用してください。'); return; }
    $('downloadAll').disabled = true; setStatus('ZIPを作成中…');
    try {
      const zip = new JSZip();
      ready.forEach((item, i) => {
        let filename = item.outputName;
        if (ready.filter(x => x.outputName === filename).length > 1) filename = `${item.name}_${i+1}.${mimeToExt[$('format').value]}`;
        zip.file(filename, item.result);
      });
      const blob = await zip.generateAsync({type:'blob'});
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = 'converted-images.zip'; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setStatus(`${ready.length}件をZIPにまとめました。`);
    } catch (e) { setStatus('ZIP作成に失敗しました：' + e.message); }
    finally { $('downloadAll').disabled = false; }
  }
  function removeItem(id) {
    const item = items.find(x => x.id === id); if (!item) return;
    if (item.url) URL.revokeObjectURL(item.url); if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    items = items.filter(x => x.id !== id); render(); setStatus('画像を削除しました。');
  }
  function clearAll() {
    items.forEach(x => { if (x.url) URL.revokeObjectURL(x.url); if (x.resultUrl) URL.revokeObjectURL(x.resultUrl); });
    items = []; render(); setStatus('一覧をクリアしました。');
  }
})();
