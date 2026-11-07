(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const NS = 'http://www.w3.org/2000/svg';
  const KEY = 'rs2.scenario';

  /* ---------- state ---------- */
  let scn, presetId = 'baseline', sel = 'spoke1', T, A;

  function load() {
    try {
      if (location.hash.indexOf('#s=') === 0) return RS.normalize(JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(3))))));
    } catch (e) { /* fall through */ }
    try { const j = localStorage.getItem(KEY); if (j) { const o = JSON.parse(j); presetId = o.presetId || 'custom'; return RS.normalize(o.scn); } } catch (e) { /* ignore */ }
    return RS.defaultScenario();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ presetId, scn })); } catch (e) { /* ignore */ } }

  const getp = p => p.split('.').reduce((o, k) => o[k], scn);
  function setp(p, v) { const k = p.split('.'), last = k.pop(); k.reduce((o, x) => o[x], scn)[last] = v; }

  /* ---------- topology geometry ---------- */
  const C = { internet: [635, 52], onprem: [125, 545], msee: [370, 545], gw: [635, 545], fw: [635, 215], vnra: [635, 375], spoke1: [1055, 245], spoke2: [1055, 525] };
  const LINKS = {
    'onprem|msee': [[220, 545], [345, 545]],
    'msee|gw': [[395, 545], [560, 545]],
    'gw|fw': [[560, 555], [475, 555], [475, 215], [560, 215]],
    'gw|vnra': [[560, 535], [485, 535], [485, 375], [560, 375]],
    'fw|vnra': [[635, 235], [635, 355]],
    'spoke1|fw': [[930, 245], [805, 245], [805, 205], [710, 205]],
    'spoke1|vnra': [[930, 245], [805, 245], [805, 365], [710, 365]],
    'spoke1|gw': [[930, 245], [805, 245], [805, 535], [710, 535]],
    'spoke2|fw': [[930, 525], [785, 525], [785, 225], [710, 225]],
    'spoke2|vnra': [[930, 525], [785, 525], [785, 385], [710, 385]],
    'spoke2|gw': [[930, 525], [785, 525], [785, 555], [710, 555]],
    'fw|internet': [[635, 195], [635, 72]],
    'vnra|internet': [[560, 355], [500, 355], [500, 40], [575, 40]],
    'spoke1|internet': [[1055, 190], [1055, 40], [700, 40]],
    'spoke2|internet': [[1180, 525], [1200, 525], [1200, 52], [700, 52]],
    'onprem|internet': [[125, 500], [125, 52], [570, 52]]
  };
  function linkPts(a, b) {
    if (LINKS[a + '|' + b]) return LINKS[a + '|' + b];
    if (LINKS[b + '|' + a]) return LINKS[b + '|' + a].slice().reverse();
    return null;
  }
  function pathFor(nodes) {
    const seq = nodes.filter((n, i) => n !== 'hub' && n !== nodes[i - 1]);
    let pts = [];
    for (let i = 1; i < seq.length; i++) {
      const p = linkPts(seq[i - 1], seq[i]);
      if (!p) continue;
      p.forEach(pt => { const l = pts[pts.length - 1]; if (!l || l[0] !== pt[0] || l[1] !== pt[1]) pts.push(pt); });
    }
    return pts;
  }
  function rounded(pts, r) {
    if (pts.length < 2) return '';
    let d = 'M' + pts[0][0] + ' ' + pts[0][1];
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i - 1], c = pts[i], n = pts[i + 1];
      const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]), l2 = Math.hypot(n[0] - c[0], n[1] - c[1]), rr = Math.min(r, l1 / 2, l2 / 2);
      const a = [c[0] - (c[0] - p[0]) / l1 * rr, c[1] - (c[1] - p[1]) / l1 * rr], b = [c[0] + (n[0] - c[0]) / l2 * rr, c[1] + (n[1] - c[1]) / l2 * rr];
      d += 'L' + a[0] + ' ' + a[1] + 'Q' + c[0] + ' ' + c[1] + ' ' + b[0] + ' ' + b[1];
    }
    const e = pts[pts.length - 1];
    return d + 'L' + e[0] + ' ' + e[1];
  }

  /* ---------- svg building ---------- */
  function el(tag, attrs, text, parent) {
    const e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(k => e.setAttribute(k, attrs[k]));
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function drawTopology() {
    const svg = $('#svg'); svg.innerHTML = '';
    const g = el('g', { id: 'world' }, null, svg);
    const hub = scn.hub, ap = hub.appliances;
    el('rect', { class: 'hubbox', x: 450, y: 110, width: 370, height: 540, rx: 14 }, null, g);
    el('text', { class: 'lbl', x: 635, y: 132 }, hub.name, g);
    el('text', { class: 'sub', x: 635, y: 146 }, hub.cidr, g);
    const hubHit = el('rect', { x: 450, y: 110, width: 370, height: 28, fill: 'transparent', style: 'cursor:pointer' }, null, g);
    hubHit.onclick = () => select('hub');

    const peerOk = id => RS.linked(scn.spokes[id]);
    RS.SPOKES.forEach(id => {
      const y = C[id][1];
      el('path', { class: 'link peer', d: 'M930 ' + y + 'L820 ' + y, style: peerOk(id) ? '' : 'stroke:var(--err)' }, null, g);
      el('text', { class: 'ltxt', x: 875, y: y - 7 }, peerOk(id) ? 'VNet peering' : 'peering DOWN', g).style.fill = peerOk(id) ? '' : 'var(--err)';
      if (RS.usesGw(scn.spokes[id])) el('text', { class: 'ltxt', x: 875, y: y + 14 }, 'remote gateway', g);
    });
    el('path', { class: 'link er', d: rounded(LINKS['onprem|msee'], 0) }, null, g);
    el('path', { class: 'link er', d: rounded(LINKS['msee|gw'], 0) }, null, g);
    el('text', { class: 'ltxt er', x: 282, y: 565 }, 'ER connection', g);
    el('path', { class: 'link', d: 'M635 150L635 72' }, null, g);
    el('text', { class: 'ltxt', x: 660, y: 100 }, 'Internet egress', g);

    const node = (id, cls) => { const n = el('g', { class: 'nd ' + (cls || '') + (sel === id ? ' sel' : ''), 'data-n': id }, null, g); n.onclick = ev => { ev.stopPropagation(); select(id); }; return n; };

    const sub = (id, y, title, sublabel, glyph, on) => {
      const n = node(id, on ? '' : 'off');
      el('rect', { class: 'shape', x: 500, y, width: 270, height: 130, rx: 10 }, null, n);
      el('text', { class: 'sub', x: 635, y: y + 22 }, title, n);
      el('rect', { class: 'shape', x: 560, y: y + 45, width: 150, height: 40, rx: 20 }, null, n);
      el('text', { class: 'lbl', x: 635, y: y + 70 }, glyph, n);
      el('text', { class: 'sub', x: 635, y: y + 110 }, sublabel, n);
    };
    sub('fw', 150, ap.fw.cidr, ap.fw.enabled ? ap.fw.ip + (ap.fw.snat ? ' · SNAT' : '') : 'not deployed', ap.fw.name, ap.fw.enabled);
    sub('vnra', 310, ap.vnra.cidr, ap.vnra.enabled ? ap.vnra.ip : 'not deployed — click to enable', 'VNRA', ap.vnra.enabled);
    const gwn = node('gw');
    el('rect', { class: 'shape', x: 500, y: 480, width: 270, height: 130, rx: 10 }, null, gwn);
    el('text', { class: 'sub', x: 635, y: 502 }, 'GatewaySubnet ' + hub.gw.cidr, gwn);
    el('rect', { class: 'shape', x: 560, y: 525, width: 150, height: 40, rx: 20 }, null, gwn);
    el('text', { class: 'lbl', x: 635, y: 550 }, hub.gw.name, gwn);
    el('text', { class: 'sub', x: 635, y: 590 }, hub.gw.rt.disablePeering ? 'peering routes disabled (preview)' : 'GatewaySubnet', gwn);

    RS.SPOKES.forEach(id => {
      const s = scn.spokes[id], n = node(id), y = C[id][1] - 55;
      el('rect', { class: 'shape', x: 930, y, width: 250, height: 110, rx: 10 }, null, n);
      el('text', { class: 'lbl', x: 1055, y: y + 30 }, s.name, n);
      el('text', { class: 'sub', x: 1055, y: y + 48 }, s.cidr, n);
      el('text', { class: 'sub', x: 1055, y: y + 68 }, 'VM ' + s.vm + (s.outbound ? ' · NAT/PIP' : ''), n);
      el('text', { class: 'sub', x: 1055, y: y + 88 }, s.rt.routes.length + ' UDR' + (s.rt.routes.length === 1 ? '' : 's'), n);
    });

    const op = node('onprem');
    el('rect', { class: 'shape', x: 30, y: 500, width: 190, height: 90, rx: 10 }, null, op);
    el('text', { class: 'lbl', x: 125, y: 535 }, scn.onprem.name, op);
    el('text', { class: 'sub', x: 125, y: 553 }, scn.onprem.networks, op);
    el('text', { class: 'sub', x: 125, y: 570 }, 'host ' + scn.onprem.host, op);

    const ms = node('msee');
    el('polygon', { class: 'tri', points: '370,505 420,585 320,585' }, null, ms);
    el('text', { class: 'ltxt er', x: 370, y: 605, style: 'font-weight:600' }, 'ExpressRoute circuit', ms);

    const inet = node('internet');
    el('path', { class: 'shape', d: 'M590 62a22 22 0 0 1 8-30a28 28 0 0 1 50-6a24 24 0 0 1 32 14a20 20 0 0 1-4 22z' }, null, inet);
    el('text', { class: 'lbl', x: 635, y: 54 }, 'Internet', inet);
    svg.onclick = () => { };
  }

  /* ---------- trace overlay ---------- */
  function drawPaths(a) {
    const g = $('#world');
    const add = (res, cls) => {
      const pts = pathFor(res.nodes);
      if (pts.length < 2) return;
      const d = rounded(pts, 14);
      el('path', { class: 'path ' + cls + (res.status === 'dropped' ? ' dropped' : ''), d }, null, g);
      const dot = el('circle', { class: 'dot', r: 5, fill: res.status === 'dropped' ? 'var(--err)' : cls === 'req' ? 'var(--acc)' : 'var(--ok)' }, null, g);
      const m = el('animateMotion', { dur: Math.max(2, pts.length * 0.7) + 's', repeatCount: 'indefinite', path: d }, null, dot);
      if (res.status === 'dropped') {
        const e = pts[pts.length - 1];
        el('text', { class: 'x', x: e[0], y: e[1] + 7 }, '✖', g);
        dot.remove();
      }
    };
    if (a.ret) add(a.ret, 'ret');
    add(a.fwd, 'req');
  }

  /* ---------- trace panel ---------- */
  function hopHtml(h, cls) {
    const r = h.route;
    return '<div class="hop ' + cls + '"><b>' + esc(RS.nodeName(scn, h.node)) + '</b>' + (r ? '<code>' + esc(r.prefix + ' → ' + r.nh + (r.ip ? ' ' + r.ip : '') + ' [' + r.src + ']') + '</code><br>' : '') + esc(h.text) + '</div>';
  }
  function renderTrace(a) {
    const f = scn.flow;
    const col = (title, res, cls) => '<div><h4>' + title + '</h4>' + (res ? res.hops.map((h, i) => hopHtml(h, cls + (res.status === 'dropped' && i === res.hops.length - 1 ? ' drop' : ''))).join('') + '<div class="note">' + (res.status === 'delivered' ? '✔ delivered' : '✖ dropped — ' + esc(res.reason)) + '</div>' : '<div class="note">Not evaluated because the request was dropped.</div>') + '</div>';
    const iss = a.issues.length ? a.issues.map(i => '<div class="iss ' + i.level + '"><b>' + esc(i.tag + ' — ' + i.title) + '</b>' + esc(i.text) + '</div>').join('') : '<div class="iss ok"><b>No problems found</b>Request and reply are both delivered' + (a.inspected ? ' and the traffic is inspected by the firewall.' : '.') + '</div>';
    $('#traceBody').innerHTML = col('Request', a.fwd, '') + col('Reply', a.ret, 'ret') + '<div><h4>Findings</h4>' + iss + '</div>';
    $('#traceSum').textContent = f.srcIp + ' → ' + f.dstIp;
    const v = $('#verdict');
    v.className = 'badge ' + a.verdict;
    v.textContent = a.fwd.status === 'dropped' ? '✖ Dropped' : a.verdict === 'error' ? '✖ Delivered one way only' : a.verdict === 'warn' ? '⚠ Delivered, with warnings' : '✔ Delivered' + (a.inspected ? ' · inspected' : '');
  }

  /* ---------- inspector ---------- */
  const NH = [['fw', 'Azure Firewall'], ['vnra', 'Routing appliance (VNRA)'], ['gateway', 'Virtual network gateway'], ['internet', 'Internet'], ['none', 'None (drop)'], ['vnet', 'Virtual network']];
  const PFX = ['0.0.0.0/0', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
  const rowI = (label, p, kind) => { const v = getp(p), bad = kind === 'cidr' ? !RS.parseCidr(v) : kind === 'ip' ? RS.ip2n(v) == null : kind === 'list' ? RS.parseList(v).bad.length : false; return '<div class="row"><label>' + label + '</label><input data-p="' + p + '" data-k="' + (kind || '') + '" value="' + esc(v) + '"' + (bad ? ' class="bad"' : '') + '></div>'; };
  const sw = (label, p, hint, pre) => '<label class="sw"><input type="checkbox" data-p="' + p + '"' + (getp(p) ? ' checked' : '') + '><span>' + label + (pre ? '<span class="pre">preview</span>' : '') + (hint ? '<small>' + hint + '</small>' : '') + '</span></label>';
  function routesEd(p) {
    const rs = getp(p);
    return '<datalist id="pfx">' + PFX.concat([RS.supernet([scn.hub.cidr, scn.spokes.spoke1.cidr, scn.spokes.spoke2.cidr])]).map(x => '<option value="' + x + '">').join('') + '</datalist>' +
      rs.map((r, i) => '<div class="rt"><input list="pfx" data-r="' + p + '" data-i="' + i + '" data-f="prefix" value="' + esc(r.prefix) + '"' + (RS.parseCidr(r.prefix) ? '' : ' class="bad"') + '><select data-r="' + p + '" data-i="' + i + '" data-f="nh">' + NH.map(n => '<option value="' + n[0] + '"' + (n[0] === r.nh ? ' selected' : '') + '>' + n[1] + '</option>').join('') + '</select><button data-del="' + p + '" data-i="' + i + '">✕</button></div>').join('') +
      '<div class="btnrow"><button data-add="' + p + '">+ Add route</button></div>';
  }
  function rtSection(p, opts) {
    return '<h3>Route table (UDRs)</h3>' + sw('Propagate gateway routes', p + '.propagate', 'BGP routes learned by the ER gateway appear in this route table.') +
      (opts.dpr ? sw('Disable peering route propagation', p + '.disablePeering', 'Removes the automatic peering (VNet) routes so a UDR can take over for the peered ranges.', true) : '') + routesEd(p + '.routes');
  }
  function routeTable(id, a) {
    if (!T[id]) return '';
    const used = new Set(); [a.fwd, a.ret].forEach(res => res && res.hops.forEach(h => { if (h.table === id && h.route) used.add(h.route); }));
    return '<h3>Effective routes — ' + esc(T[id].title) + '</h3><table><tr><th>Source</th><th>Prefix</th><th>Next hop</th><th>State</th></tr>' +
      T[id].routes.map(r => '<tr class="' + (r.state === 'Active' ? '' : 'inv') + (used.has(r) ? ' used' : '') + '" title="' + esc(r.note || '') + '"><td>' + esc(r.src) + '</td><td>' + r.prefix + '</td><td>' + esc(r.nh + (r.ip ? ' ' + r.ip : '')) + '</td><td>' + r.state + '</td></tr>').join('') + '</table><div class="note">Highlighted rows were used by the current flow. Struck-through routes are overridden.</div>';
  }
  function renderInspector() {
    const a = A, id = sel, ap = scn.hub.appliances;
    let h = '';
    const title = (t, s) => '<h2>' + esc(t) + '</h2><div class="note">' + s + '</div>';
    if (id === 'onprem') {
      h = title(scn.onprem.name, 'Your datacenter, connected to Azure over ExpressRoute.') + rowI('Name', 'onprem.name') + rowI('Host IP', 'onprem.host', 'ip') + rowI('Connected networks', 'onprem.networks', 'list') +
        '<h3>BGP advertisement to Azure</h3>' + rowI('Advertised prefixes', 'onprem.advertise', 'list') + '<div class="note">Comma separated CIDRs. Anything advertised that is not a connected network is an aggregate pointing at Null0 on-prem.</div>' +
        '<div class="btnrow"><button data-act="advRfc">RFC1918</button><button data-act="advConn">Only connected networks</button><button data-act="advDef">+ 0.0.0.0/0</button></div>';
    } else if (id === 'msee') {
      h = title('ExpressRoute circuit (MSEE)', 'Microsoft edge routers. They hold routes from both sides and hand each packet to the side with the longest matching prefix; Azure wins a tie.');
    } else if (id === 'hub') {
      h = title(scn.hub.name, 'Hub virtual network.') + rowI('Name', 'hub.name') + rowI('Address space', 'hub.cidr', 'cidr');
    } else if (id === 'gw') {
      h = title(scn.hub.gw.name, 'ExpressRoute gateway in the GatewaySubnet.') + rowI('Subnet CIDR', 'hub.gw.cidr', 'cidr') + rtSection('hub.gw.rt', { dpr: true });
    } else if (id === 'fw' || id === 'vnra') {
      const p = 'hub.appliances.' + id;
      h = title(ap[id].name, id === 'fw' ? 'Stateful Azure Firewall. Drops asymmetric flows.' : 'Virtual Network Routing Appliance (preview) — a forwarder that does not SNAT or track sessions.') + sw('Deployed', p + '.enabled') +
        (ap[id].enabled ? rowI('Subnet CIDR', p + '.cidr', 'cidr') + rowI('Private IP', p + '.ip', 'ip') + sw('SNAT to the Internet', p + '.snat', 'Used when this appliance sends traffic to the Internet.') + sw('Policy allows the flow', p + '.allow', 'Turn off to see a policy deny.') + rtSection(p + '.rt', { dpr: true }) : '');
    } else if (scn.spokes[id]) {
      const p = 'spokes.' + id;
      h = title(scn.spokes[id].name, 'Spoke virtual network, peered to the hub.') + rowI('Name', p + '.name') + rowI('Address space', p + '.cidr', 'cidr') + rowI('VM IP', p + '.vm', 'ip') +
        sw('Explicit outbound (NAT Gateway / public IP)', p + '.outbound', 'Default outbound access is retired: without this, system route 0.0.0.0/0 → Internet drops.') +
        '<h3>Peering: spoke → hub</h3>' + sw('Allow access to remote network', p + '.peerToHub.access') + sw('Allow forwarded traffic', p + '.peerToHub.fwd', 'Needed when the hub forwards traffic into this spoke.') + sw('Use remote gateway', p + '.peerToHub.useRemoteGw', 'Learn on-prem routes through the hub ER gateway.') +
        '<h3>Peering: hub → spoke</h3>' + sw('Allow access to remote network', p + '.peerFromHub.access') + sw('Allow forwarded traffic', p + '.peerFromHub.fwd') + sw('Allow gateway transit', p + '.peerFromHub.gwTransit') +
        rtSection(p + '.rt', {});
    }
    if (id === 'internet') h = title('Internet', 'Public destination. Set the destination IP in the flow bar (default ' + scn.internetIp + ').');
    $('#insp').innerHTML = h + routeTable(id, a);
  }

  /* ---------- flow bar ---------- */
  function renderFlow() {
    const f = scn.flow, src = $('#fSrc');
    src.innerHTML = ['spoke1', 'spoke2', 'onprem'].map(i => '<option value="' + i + '"' + (f.src === i ? ' selected' : '') + '>' + esc(RS.nodeName(scn, i)) + '</option>').join('');
    $('#fSrcIp').value = f.srcIp; $('#fDstIp').value = f.dstIp;
    const dst = [[scn.spokes.spoke1.name, scn.spokes.spoke1.vm], [scn.spokes.spoke2.name, scn.spokes.spoke2.vm], [scn.onprem.name, scn.onprem.host], ['Internet', scn.internetIp]];
    $('#quick').innerHTML = dst.map(d => '<button data-ip="' + d[1] + '" title="' + d[1] + '">→ ' + esc(d[0]) + '</button>').join('');
    $('#dstList').innerHTML = dst.map(d => '<option value="' + d[1] + '">' + esc(d[0]) + '</option>').join('');
    $('#fSrcIp').className = RS.ip2n(f.srcIp) == null ? 'bad' : ''; $('#fDstIp').className = RS.ip2n(f.dstIp) == null ? 'bad' : '';
  }
  function hostOf(id) { return id === 'onprem' ? scn.onprem.host : scn.spokes[id].vm; }

  /* ---------- main render ---------- */
  function render() {
    scn = RS.normalize(scn);
    T = RS.buildTables(scn);
    A = RS.analyze(scn, T, scn.flow);
    drawTopology(); drawPaths(A); renderFlow(); renderTrace(A); renderInspector(); renderChip(); renderPresets();
    applyView();
  }
  function renderChip() {
    const w = RS.validate(scn), c = $('#vchip');
    c.hidden = !w.length;
    c.className = 'chip' + (w.some(x => x.level === 'error') ? ' error' : '');
    c.textContent = '⚠ ' + w.length + ' issue' + (w.length === 1 ? '' : 's');
    c.title = w.map(x => x.msg).join('\n');
    c.onclick = () => alert(w.map(x => '• ' + x.msg).join('\n'));
  }
  function renderPresets() {
    const p = $('#preset'), cur = RS.presets.find(x => x.id === presetId);
    p.innerHTML = RS.presets.map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('') + (cur ? '' : '<option value="custom">Custom (edited)</option>');
    p.value = cur ? presetId : 'custom';
    $('#pdesc').textContent = cur ? cur.desc : 'Your own scenario. Pick a preset to start over.';
  }
  function changed() { presetId = 'custom'; save(); render(); }
  function select(id) { sel = id; render(); }

  const PF = { asym: { dst: 'onprem' }, inspectonprem: { dst: 'onprem' }, dpr: { src: 'onprem', dst: 'spoke1' }, vnra: { dst: 'onprem' }, noroute: { dst: 'internet' }, natgw: { dst: 'internet' } };
  function loadPreset(id) {
    scn = RS.applyPreset(id); presetId = id;
    const o = PF[id];
    if (o) {
      const ip = k => k === 'internet' ? scn.internetIp : hostOf(k);
      if (o.src) { scn.flow.src = o.src; scn.flow.srcIp = hostOf(o.src); }
      scn.flow.dstIp = ip(o.dst);
    }
    save(); render();
  }

  /* ---------- events ---------- */
  $('#insp').addEventListener('change', ev => {
    const t = ev.target;
    if (t.dataset.p) {
      setp(t.dataset.p, t.type === 'checkbox' ? t.checked : t.value.trim());
      if (/\.(cidr|ip)$/.test(t.dataset.p) || t.dataset.p === 'onprem.host') relinkFlow();
      changed();
    } else if (t.dataset.r) { getp(t.dataset.r)[+t.dataset.i][t.dataset.f] = t.dataset.f === 'prefix' ? t.value.trim() : t.value; changed(); }
  });
  $('#insp').addEventListener('click', ev => {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.dataset.del) { getp(t.dataset.del).splice(+t.dataset.i, 1); changed(); }
    else if (t.dataset.add) { getp(t.dataset.add).push({ prefix: '', nh: 'fw' }); changed(); }
    else if (t.dataset.act) {
      const c = RS.parseList(scn.onprem.networks).ok;
      scn.onprem.advertise = t.dataset.act === 'advRfc' ? RS.RFC1918.join(', ') : t.dataset.act === 'advConn' ? c.join(', ') : RS.parseList(scn.onprem.advertise).ok.concat('0.0.0.0/0').filter((x, i, r) => r.indexOf(x) === i).join(', ');
      changed();
    }
  });
  function relinkFlow() { /* keep flow endpoints in sync with host IPs when they were defaults */ }
  $('#fSrc').onchange = e => { scn.flow.src = e.target.value; scn.flow.srcIp = hostOf(e.target.value); save(); render(); };
  $('#fSrcIp').onchange = e => { scn.flow.srcIp = e.target.value.trim(); save(); render(); };
  $('#fDstIp').onchange = e => { scn.flow.dstIp = e.target.value.trim(); save(); render(); };
  $('#quick').onclick = e => { const b = e.target.closest('button'); if (b) { scn.flow.dstIp = b.dataset.ip; save(); render(); } };
  $('#preset').onchange = e => { if (e.target.value !== 'custom') loadPreset(e.target.value); };
  $('#bReset').onclick = () => loadPreset('baseline');
  $('#bTheme').onclick = () => { document.body.classList.toggle('light'); localStorage.setItem('rs2.theme', document.body.classList.contains('light') ? 'light' : 'dark'); };
  $('#bTrace').onclick = () => { $('#trace').classList.toggle('col'); $('#bTrace').textContent = $('#trace').classList.contains('col') ? '▴' : '▾'; };
  $('#bShare').onclick = () => {
    const u = location.href.split('#')[0] + '#s=' + btoa(unescape(encodeURIComponent(JSON.stringify(scn))));
    history.replaceState(null, '', u);
    (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => alert('Link copied to clipboard.'), () => prompt('Copy this link', u));
  };
  $('#bExport').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(scn, null, 2)], { type: 'application/json' }));
    a.download = 'routing-scenario.json'; a.click();
  };
  $('#bImport').onclick = () => $('#fImport').click();
  $('#fImport').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => { try { scn = RS.normalize(JSON.parse(t)); presetId = 'custom'; save(); render(); } catch (x) { alert('Not a valid scenario file.'); } });
    e.target.value = '';
  };

  /* ---------- zoom / pan ---------- */
  let vb = { x: 0, y: 0, w: 1220, h: 680 };
  function applyView() { $('#svg').setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h); }
  const svg = $('#svg');
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect(), k = e.deltaY < 0 ? 0.88 : 1.14;
    const base = Math.max(1220 / r.width, 680 / r.height), sc = vb.w / (r.width * (vb.w / vb.w));
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    const nw = Math.min(2400, Math.max(300, vb.w * k)), nh = nw * vb.h / vb.w;
    vb = { x: vb.x + (vb.w - nw) * px, y: vb.y + (vb.h - nh) * py, w: nw, h: nh }; applyView();
  }, { passive: false });
  let drag = null;
  svg.addEventListener('pointerdown', e => { if (e.target.closest('.nd')) return; drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y }; svg.setPointerCapture(e.pointerId); svg.style.cursor = 'grabbing'; });
  svg.addEventListener('pointermove', e => { if (!drag) return; const r = svg.getBoundingClientRect(); vb.x = drag.vx - (e.clientX - drag.x) * vb.w / r.width; vb.y = drag.vy - (e.clientY - drag.y) * vb.h / r.height; applyView(); });
  svg.addEventListener('pointerup', () => { drag = null; svg.style.cursor = ''; });
  $('#zoom').onclick = e => {
    const z = e.target.dataset.z; if (!z) return;
    if (z === 'reset') vb = { x: 0, y: 0, w: 1220, h: 680 };
    else { const k = z === 'in' ? 0.8 : 1.25, nw = vb.w * k, nh = vb.h * k; vb = { x: vb.x + (vb.w - nw) / 2, y: vb.y + (vb.h - nh) / 2, w: nw, h: nh }; }
    applyView();
  };

  /* ---------- init ---------- */
  if (localStorage.getItem('rs2.theme') === 'light') document.body.classList.add('light');
  scn = load();
  render();
})();
