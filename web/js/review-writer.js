// ==========================================
// ตัวเขียนรีวิวแบบสุ่ม (ป้ายยา) ไม่ใช้ AI ได้ทันที ไม่เสียโทเคน
// ใช้ข้อมูลจริงของสินค้าเท่านั้น (ชื่อ ราคา คะแนน ยอดขาย แบรนด์ ร้าน สเปก รายละเอียด) ไม่อ้างว่าใช้เอง
// ประโยคเขียนเป็น spintax {ก|ข|ค} ซ้อนกันได้ ถ้าข้อมูลส่วนไหนไม่มี ข้ามบรรทัดนั้น
//   ReviewWriter.random(product)  → ข้อความรีวิว
//   ReviewWriter.spin("{ก|ข}")   → สุ่มหนึ่งแบบ
// ==========================================
(function (root) {
  // แทน {ก|ข} ชั้นในสุดก่อน จนไม่เหลือวงเล็บ
  function spin(text, rand = Math.random) {
    let s = String(text);
    for (let i = 0; i < 50 && /\{[^{}]*\}/.test(s); i++) {
      s = s.replace(/\{([^{}]*)\}/g, (_, body) => {
        const opts = body.split("|");
        return opts[Math.floor(rand() * opts.length)];
      });
    }
    return s;
  }

  // ชื่อจากเว็บขายของมักยาวและอัดคำค้น ตัดให้อ่านง่าย (ตัดที่เว้นวรรคก่อน 60 ตัวอักษร)
  function shortTitle(title) {
    const t = String(title || "").replace(/[【\[][^】\]]*[】\]]/g, " ").replace(/\s+/g, " ").trim();
    if (t.length <= 60) return t;
    const cut = t.lastIndexOf(" ", 60);
    return (cut > 20 ? t.slice(0, cut) : t.slice(0, 60)).trim();
  }

  // บรรทัดเด่นจากรายละเอียดสินค้า: บรรทัดสั้นๆ ที่มีเนื้อหา ไม่ใช่แฮชแท็กหรือลิงก์
  function highlights(desc, max) {
    return String(desc || "").split(/\n+/)
      .filter(l => !/https?:|#\S/.test(l))
      .map(l => l.replace(/^[\s•\-*✅✔️🔥⭐️✨]+/u, "").trim())
      .filter(l => l.length >= 8 && l.length <= 120)
      .filter((l, i, a) => a.indexOf(l) === i)
      .slice(0, max);
  }

  const T = {
    hook: [
      "{ใครกำลังมองหา|ใครที่ตามหา|สายไหนที่อยากได้} {name} {อยู่|อยู่บ้าง} {ขอป้ายยาตัวนี้เลย|ต้องดูตัวนี้|มาทางนี้เลย} {✨|🔥|💖|👀}",
      "{วันนี้ขอป้ายยา|ป้ายยาของดีวันนี้|ขอแนะนำไอเทมนี้} {name} {ตัวนี้กำลังมาแรง|ตัวนี้คนพูดถึงเยอะ|ตัวนี้น่าสนใจมาก} {✨|🔥|🛒}",
      "{เจอของดีมาบอกต่อ|ไอเทมนี้ต้องบอกต่อ|ของมันต้องมีอีกชิ้น} {💡|✨|🔥} {name}",
    ],
    rating: "{คะแนนรีวิว|เรตติ้งจากคนซื้อ|คะแนนเฉลี่ย} ⭐ {rating}/5{count}",
    count: " {จาก|จากผู้ซื้อ} {n} {รีวิว|คน}",
    sold: "{ยอดขายตอนนี้|ตอนนี้} {sold}",
    brand: "{แบรนด์|ของแบรนด์} {brand}",
    shop: "{ส่งจากร้าน|ร้าน} {shop}",
    points: "{จุดเด่นที่น่าสนใจ|ไฮไลต์ของตัวนี้|ที่ชอบคือ} 👇",
    price: [
      "{ราคาตอนนี้|ราคาล่าสุดที่เห็น|ราคาประมาณ} {price} {ถือว่าคุ้ม|คุ้มเลย|ไม่แรงเลย} {(ราคาเปลี่ยนตามโปร)|(ราคาอาจเปลี่ยนตามโปรโมชั่น)}",
      "{ได้มาในราคา|ราคาเพียง} {price} {เท่านั้น|} {(เช็กโปรล่าสุดก่อนสั่ง)|(ราคาอาจเปลี่ยนแปลง)}",
    ],
    cta: [
      "{กดดูราคาล่าสุดได้ที่ปุ่มด้านล่าง|เช็กโปรล่าสุดที่ปุ่มสั่งซื้อ|พิกัดอยู่ที่ปุ่มด้านล่างเลย} {👇|⬇️|🛒}",
      "{ใครสนใจ|ถ้าชอบ|ใครอยากได้} {กดดูรายละเอียดเพิ่มที่ปุ่มด้านล่าง|เช็กราคาและโปรที่ปุ่มด้านล่าง} {👇|🛒}",
    ],
  };

  const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];
  // {name} ฯลฯ คือช่องข้อมูล ไม่ใช่ตัวเลือก: กันไว้ก่อนสุ่ม แล้วค่อยใส่ค่า (ค่ามีวงเล็บปีกกาได้ไม่พัง)
  const fill = (tpl, vars, rand) => spin(String(tpl).replace(/\{(\w+)\}/g, "\u0001$1\u0002"), rand)
    .replace(/\u0001(\w+)\u0002/g, (m, k) => (k in vars ? vars[k] : ""));

  // p: แถวสินค้า (title, price_text, price, sold_text, shop, description, details)
  function random(p, rand = Math.random) {
    const d = (p && p.details) || {};
    const price = p.price_text || (p.price != null && p.price !== "" ? `฿${Number(p.price).toLocaleString("th-TH")}` : "");
    const rating = Number(d.rating);
    const lines = [];
    lines.push(fill(pick(T.hook, rand), { name: shortTitle(p.title) }, rand));

    const proof = [];
    if (rating > 0) {
      const count = Number(d.rating_count) > 0 ? fill(T.count, { n: Number(d.rating_count).toLocaleString("th-TH") }, rand) : "";
      proof.push(fill(T.rating, { rating: rating.toFixed(1), count }, rand));
    }
    if (p.sold_text) proof.push(/ขาย|sold/i.test(p.sold_text) ? p.sold_text : fill(T.sold, { sold: p.sold_text }, rand));
    if (d.brand) proof.push(fill(T.brand, { brand: d.brand }, rand));
    if (p.shop && p.shop !== d.brand) proof.push(fill(T.shop, { shop: p.shop }, rand));
    if (proof.length) lines.push(proof.join(" · "));

    const specs = Object.entries(d.specs && typeof d.specs === "object" ? d.specs : {})
      .filter(([k, v]) => String(v).trim() && String(v).length <= 60 && !/คลัง|stock|หมวดหมู่|category/i.test(k))
      .slice(0, 4).map(([k, v]) => `${k}: ${v}`);
    const points = [...highlights(p.description, 4 - Math.min(specs.length, 2)), ...specs].slice(0, 5);
    if (points.length) lines.push(`${spin(T.points, rand)}\n${points.map(x => `• ${x}`).join("\n")}`);

    if (price) lines.push(fill(pick(T.price, rand), { price }, rand).replace(/\s+/g, " ").trim());
    lines.push(spin(pick(T.cta, rand), rand));
    return lines.map(l => l.replace(/[ \t]+/g, " ").replace(/ +$/gm, "").trim()).join("\n\n");
  }

  root.ReviewWriter = { spin, random, shortTitle };
})(typeof window !== "undefined" ? window : globalThis);
