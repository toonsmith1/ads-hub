/**
 * แท็บ "คลังโฆษณา (Ad Hub)" ในแดชบอร์ด: เชื่อมบัญชี และส่งสินค้าที่บันทึกไว้เข้าคลัง
 * ใช้ HubService (libs/hub-service.js) และ StorageService (libs/storage-service.js)
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function setMessage(text, isError) {
    const el = $('adhub-message');
    el.textContent = text || '';
    el.style.color = isError ? '#f87171' : '';
  }

  async function render() {
    const st = await HubService.status();
    const cfg = await HubService.getConfig();
    $('adhub-connected').style.display = st.connected ? 'block' : 'none';
    $('adhub-form').style.display = st.connected ? 'none' : 'block';
    $('adhub-email').textContent = st.email;
    $('adhub-url').textContent = st.url;
    $('adhub-send-all').disabled = !st.connected;
    const badge = $('adhub-nav-badge');
    badge.textContent = st.connected ? 'เชื่อมแล้ว' : 'ปิด';
    badge.style.background = st.connected ? 'linear-gradient(135deg, #10b981, #059669)' : '#475569';
    if (!st.connected) {
      $('adhub-input-url').value = $('adhub-input-url').value || cfg.url || '';
      $('adhub-input-key').value = $('adhub-input-key').value || cfg.key || '';
      $('adhub-input-email').value = $('adhub-input-email').value || cfg.email || '';
    }
  }

  async function connect(e) {
    e.preventDefault();
    const btn = $('adhub-connect');
    btn.disabled = true;
    setMessage('กำลังเชื่อมต่อ...');
    try {
      const res = await HubService.connect($('adhub-input-url').value, $('adhub-input-key').value,
        $('adhub-input-email').value, $('adhub-input-password').value);
      $('adhub-input-password').value = '';
      setMessage(`เชื่อมต่อสำเร็จ (${res.email}) กลับไปหน้า Shopee แล้วกด "ส่งเข้าคลังโฆษณา" ได้เลย`);
    } catch (err) {
      setMessage(`เชื่อมต่อไม่สำเร็จ: ${err.message}`, true);
    }
    btn.disabled = false;
    render();
  }

  async function disconnect() {
    await HubService.disconnect();
    setMessage('ตัดการเชื่อมต่อแล้ว');
    render();
  }

  async function sendAll() {
    const btn = $('adhub-send-all');
    const out = $('adhub-send-result');
    const products = window.StorageService ? await window.StorageService.getProducts() : [];
    if (!products.length) {
      out.textContent = 'ยังไม่มีสินค้าที่บันทึกไว้ในแดชบอร์ด';
      return;
    }
    btn.disabled = true;
    out.style.color = '';
    out.textContent = `กำลังส่ง ${products.length} รายการ...`;
    try {
      const res = await HubService.importProducts(products, '', 'pending');
      out.textContent = `ส่งแล้ว: ใหม่ ${res.added} · อัปเดตของเดิม ${res.updated}${res.skipped ? ` · ข้าม ${res.skipped} (ไม่มีชื่อหรือลิงก์)` : ''}`;
    } catch (err) {
      out.style.color = '#f87171';
      out.textContent = `ส่งไม่สำเร็จ: ${err.message}`;
    }
    btn.disabled = false;
  }

  function init() {
    if (!$('tab-adhub') || typeof HubService === 'undefined') return;
    $('adhub-form').addEventListener('submit', connect);
    $('adhub-disconnect').addEventListener('click', disconnect);
    $('adhub-send-all').addEventListener('click', sendAll);
    const navBtn = document.querySelector('[data-tab="tab-adhub"]');
    navBtn.addEventListener('click', () => {
      const title = document.getElementById('active-tab-title');
      if (title) title.textContent = 'คลังโฆษณา (Ad Hub)';
    });
    // เปิดมาจากปุ่มบนหน้า Shopee ตอนยังไม่ได้เชื่อม
    if (location.hash === '#tab-adhub') setTimeout(() => navBtn.click(), 0);
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
