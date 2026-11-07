/* Azure Hub & Spoke routing engine — pure functions, no DOM. Works in the browser (window.RS) and Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- IPv4 helpers ---------- */
  const RFC_ALL = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10'];
  const RFC1918 = RFC_ALL.slice(0, 3);
  const ip2n = s => {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    const o = m.slice(1).map(Number);
    if (o.some(x => x > 255)) return null;
    return ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];
  };
  const n2ip = n => [24, 16, 8, 0].map(sh => Math.floor(n / Math.pow(2, sh)) % 256).join('.');
  function parseCidr(s) {
    const m = /^\s*(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})\s*$/.exec(String(s == null ? '' : s));
    if (!m) return null;
    const a = ip2n(m[1]), len = +m[2];
    if (a == null || len > 32) return null;
    const size = Math.pow(2, 32 - len), net = Math.floor(a / size) * size;
    return { net, len, size, end: net + size - 1, str: n2ip(net) + '/' + len };
  }
  const maskLen = p => +String(p).split('/')[1];
  const contains = (c, ip) => { const p = parseCidr(c), n = ip2n(ip); return !!p && n != null && n >= p.net && n <= p.end; };
  const covers = (a, b) => { const p = parseCidr(a), q = parseCidr(b); return !!p && !!q && p.net <= q.net && p.end >= q.end; };
  const overlaps = (a, b) => { const p = parseCidr(a), q = parseCidr(b); return !!p && !!q && p.net <= q.end && q.net <= p.end; };
  function parseList(s) {
    const ok = [], bad = [];
    String(s || '').split(/[\s,;]+/).filter(Boolean).forEach(t => {
      const p = parseCidr(t);
      if (!p) bad.push(t); else if (!ok.includes(p.str)) ok.push(p.str);
    });
    return { ok, bad };
  }
  function supernet(list) {
    const ps = list.map(parseCidr).filter(Boolean);
    if (!ps.length) return null;
    const lo = Math.min.apply(null, ps.map(p => p.net)), hi = Math.max.apply(null, ps.map(p => p.end));
    for (let len = 32; len > 0; len--) {
      const size = Math.pow(2, 32 - len), net = Math.floor(lo / size) * size;
      if (net + size - 1 >= hi) return n2ip(net) + '/' + len;
    }
    return '0.0.0.0/0';
  }
  const hostIn = (cidr, off) => { const p = parseCidr(cidr); return p ? n2ip(p.net + off) : ''; };
  const isPrivate = ip => RFC_ALL.some(c => contains(c, ip));

  /* ---------- Scenario ---------- */
  const emptyRt = () => ({ propagate: true, disablePeering: false, routes: [] });
  function defaultScenario() {
    const spoke = (name, cidr, vm) => ({
      name, cidr, vm, outbound: false,
      peerToHub: { access: true, fwd: true, useRemoteGw: true },
      peerFromHub: { access: true, fwd: true, gwTransit: true },
      rt: { propagate: true, disablePeering: false, routes: [{ prefix: '0.0.0.0/0', nh: 'fw' }] }
    });
    return {
      name: 'Baseline',
      onprem: { name: 'On-prem datacenter', networks: '192.168.0.0/16', advertise: RFC1918.join(', '), host: '192.168.10.10' },
      hub: {
        name: 'vnet-hub', cidr: '172.16.0.0/24',
        gw: { name: 'ER Gateway', cidr: '172.16.0.0/26', rt: emptyRt() },
        appliances: {
          fw: { enabled: true, name: 'Azure Firewall', cidr: '172.16.0.64/26', ip: '172.16.0.68', snat: true, allow: true, rt: emptyRt() },
          vnra: { enabled: false, name: 'Routing Appliance (VNRA)', cidr: '172.16.0.128/26', ip: '172.16.0.132', snat: false, allow: true, rt: emptyRt() }
        }
      },
      spokes: {
        spoke1: spoke('vnet-spoke-01', '172.16.1.0/24', '172.16.1.10'),
        spoke2: spoke('vnet-spoke-02', '172.16.2.0/24', '172.16.2.10')
      },
      flow: { src: 'spoke1', srcIp: '172.16.1.10', dst: 'spoke2', dstIp: '172.16.2.10' },
      internetIp: '20.50.60.70'
    };
  }
  function merge(base, over) {
    if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
    const out = {};
    Object.keys(base).forEach(k => { out[k] = merge(base[k], over && over[k]); });
    if (over && typeof over === 'object') Object.keys(over).forEach(k => { if (!(k in out)) out[k] = over[k]; });
    return out;
  }
  const normalize = o => { const s = merge(defaultScenario(), o); s.hub.gw.rt.propagate = true; s.hub.appliances.fw.rt.routes = s.hub.appliances.fw.rt.routes.filter(r => r.prefix !== '0.0.0.0/0'); return s; };
  const clone = o => JSON.parse(JSON.stringify(o));

  const SPOKES = ['spoke1', 'spoke2'];
  const APPS = ['fw', 'vnra'];
  const linked = s => !!(s.peerToHub.access && s.peerFromHub.access);
  const usesGw = s => linked(s) && !!s.peerToHub.useRemoteGw && !!s.peerFromHub.gwTransit;
  const advert = scn => parseList(scn.onprem.advertise).ok;
  const connected = scn => parseList(scn.onprem.networks).ok;

  function nodeName(scn, id) {
    switch (id) {
      case 'onprem': return scn.onprem.name;
      case 'msee': return 'ExpressRoute circuit (MSEE)';
      case 'gw': return scn.hub.gw.name;
      case 'fw': return scn.hub.appliances.fw.name;
      case 'vnra': return scn.hub.appliances.vnra.name;
      case 'hub': return scn.hub.name;
      case 'internet': return 'Internet';
      default: return scn.spokes[id] ? scn.spokes[id].name : id;
    }
  }

  /* ---------- Route tables ---------- */
  function userRoutes(scn, rt) {
    const out = [];
    (rt.routes || []).forEach(r => {
      const p = parseCidr(r.prefix);
      if (!p) return;
      const base = { src: 'User', prefix: p.str, pri: 6 };
      if (r.nh === 'fw' || r.nh === 'vnra') { const a = scn.hub.appliances[r.nh]; out.push(Object.assign(base, { nh: 'VirtualAppliance', ip: a.ip, via: r.nh })); }
      else if (r.nh === 'gateway') out.push(Object.assign(base, { nh: 'VirtualNetworkGateway' }));
      else if (r.nh === 'internet') out.push(Object.assign(base, { nh: 'Internet' }));
      else if (r.nh === 'none') out.push(Object.assign(base, { nh: 'None' }));
      else if (r.nh === 'vnet') out.push(Object.assign(base, { nh: 'VnetLocal' }));
    });
    return out;
  }
  function sysDefaults(cidrs) {
    const out = [];
    cidrs.forEach(c => { const p = parseCidr(c); if (p) out.push({ src: 'Default', prefix: p.str, nh: 'VnetLocal', pri: 4 }); });
    out.push({ src: 'Default', prefix: '0.0.0.0/0', nh: 'Internet', pri: 1 });
    RFC_ALL.forEach(p => out.push({ src: 'Default', prefix: p, nh: 'None', pri: 1 }));
    return out;
  }
  function finalize(rs) {
    const by = {};
    rs.forEach(r => { (by[r.prefix] = by[r.prefix] || []).push(r); });
    Object.keys(by).forEach(k => {
      const g = by[k].slice().sort((a, b) => b.pri - a.pri);
      g.forEach((r, i) => { r.state = i === 0 ? 'Active' : 'Invalid'; if (i) r.note = 'Overridden by the ' + g[0].src + ' route for the same prefix'; });
    });
    if (rs.some(r => r.src === 'User' && r.prefix === '0.0.0.0/0' && r.state === 'Active'))
      rs.forEach(r => { if (r.src === 'Default' && r.nh === 'None' && r.state === 'Active') { r.state = 'Invalid'; r.note = 'Replaced by the 0.0.0.0/0 user-defined route'; } });
    return rs.sort((a, b) => maskLen(b.prefix) - maskLen(a.prefix) || b.pri - a.pri);
  }
  function hubTable(scn, rt, title, withBgp, lockInternet) {
    const rs = sysDefaults([scn.hub.cidr]);
    if (!rt.disablePeering) SPOKES.forEach(id => {
      const s = scn.spokes[id], p = parseCidr(s.cidr);
      if (p && linked(s)) rs.push({ src: 'Default', prefix: p.str, nh: 'VNetPeering', to: id, pri: 4 });
    });
    if (withBgp && rt.propagate) advert(scn).forEach(p => rs.push({ src: 'BGP', prefix: p, nh: 'VirtualNetworkGateway', pri: 5 }));
    let ur = userRoutes(scn, rt);
    if (lockInternet) ur = [{ src: 'User', prefix: '0.0.0.0/0', nh: 'Internet', pri: 6, note: 'Required by Azure Firewall; cannot be changed' }].concat(ur.filter(r => r.prefix !== '0.0.0.0/0'));
    return { title, routes: finalize(rs.concat(ur)) };
  }
  function buildTables(scn) {
    const T = {};
    SPOKES.forEach(id => {
      const s = scn.spokes[id];
      const rs = sysDefaults([s.cidr]);
      const h = parseCidr(scn.hub.cidr);
      if (h && linked(s)) rs.push({ src: 'Default', prefix: h.str, nh: 'VNetPeering', to: 'hub', pri: 4 });
      if (usesGw(s) && s.rt.propagate) advert(scn).forEach(p => rs.push({ src: 'BGP', prefix: p, nh: 'VirtualNetworkGateway', pri: 5 }));
      T[id] = { title: s.name + ' subnet', routes: finalize(rs.concat(userRoutes(scn, s.rt))) };
    });
    T.gw = hubTable(scn, Object.assign({}, scn.hub.gw.rt, { propagate: true }), 'GatewaySubnet', false);
    APPS.forEach(id => { T[id] = hubTable(scn, scn.hub.appliances[id].rt, scn.hub.appliances[id].name + ' subnet', true, id === 'fw'); });

    const az = [];
    const hp = parseCidr(scn.hub.cidr);
    if (hp) az.push(hp.str);
    SPOKES.forEach(id => { const s = scn.spokes[id], p = parseCidr(s.cidr); if (p && usesGw(s)) az.push(p.str); });
    const adv = advert(scn);
    T.msee = {
      title: 'ExpressRoute circuit (MSEE)',
      routes: finalize(az.map(p => ({ src: 'Advertised by Azure (gateway)', prefix: p, nh: 'Azure', pri: 3 }))
        .concat(adv.map(p => ({ src: 'Advertised by on-prem (CE)', prefix: p, nh: 'OnPrem', pri: 2 }))))
    };
    const conn = connected(scn), onp = conn.map(p => ({ src: 'Connected', prefix: p, nh: 'Local', pri: 5 }));
    adv.forEach(p => { if (p !== '0.0.0.0/0' && !conn.includes(p)) onp.push({ src: 'Originated aggregate', prefix: p, nh: 'Null0', pri: 3 }); });
    az.forEach(p => onp.push({ src: 'Learned via ExpressRoute', prefix: p, nh: 'ExpressRoute', pri: 2 }));
    onp.push({ src: 'Static', prefix: '0.0.0.0/0', nh: 'LocalInternetEdge', pri: 1 });
    T.onprem = { title: scn.onprem.name + ' core router', routes: finalize(onp) };
    return T;
  }

  function matches(routes, ip) {
    return routes.filter(r => contains(r.prefix, ip)).sort((a, b) => maskLen(b.prefix) - maskLen(a.prefix));
  }
  function lpm(routes, ip) {
    let best = null;
    routes.forEach(r => { if (r.state === 'Active' && contains(r.prefix, ip) && (!best || maskLen(r.prefix) > maskLen(best.prefix))) best = r; });
    return best;
  }

  /* ---------- Endpoint ownership ---------- */
  function owner(scn, ip) {
    if (ip2n(ip) == null) return { kind: 'invalid' };
    for (const id of SPOKES) if (contains(scn.spokes[id].cidr, ip)) return { kind: 'spoke', id };
    if (contains(scn.hub.cidr, ip)) return { kind: 'hub' };
    if (connected(scn).some(c => contains(c, ip))) return { kind: 'onprem' };
    if (isPrivate(ip)) return { kind: 'unknown' };
    return { kind: 'internet' };
  }

  /* ---------- Packet walk ---------- */
  function walk(scn, T, start, srcIp, dstIp) {
    const nodes = [start], hops = [], own = owner(scn, dstIp);
    let cur = start, from = null, snat = false;
    const seen = {};
    const H = (node, table, route, text) => hops.push({ node, table, route, text, cands: table && T[table] ? matches(T[table].routes, dstIp) : [] });
    const fin = (status, reason) => ({ status, reason: reason || '', nodes, hops, snat });
    const go = (n, f) => { nodes.push(n); cur = n; from = f; };
    const A = id => scn.hub.appliances[id];
    const rname = r => r.prefix + ' → ' + r.nh;

    if (own.kind === 'invalid') return fin('dropped', 'Invalid destination IP');

    for (let g = 0; g < 30; g++) {
      const key = cur + '|' + from;
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 2) return fin('dropped', 'Routing loop detected');

      if (scn.spokes[cur]) {
        const s = scn.spokes[cur], r = lpm(T[cur].routes, dstIp);
        if (!r) { H(cur, cur, null, 'No matching route'); return fin('dropped', 'No route in ' + s.name); }
        if (r.nh === 'VnetLocal') {
          if (own.kind === 'spoke' && own.id === cur) { H(cur, cur, r, 'Destination is inside the same VNet — delivered locally'); return fin('delivered'); }
          H(cur, cur, r, 'Next hop "Virtual network" but the destination is not in this VNet'); return fin('dropped', 'Destination not in ' + s.name);
        }
        if (r.nh === 'VNetPeering') {
          H(cur, cur, r, 'Peering route to the hub VNet — delivered in the hub'); nodes.push('hub');
          return own.kind === 'hub' ? fin('delivered') : fin('dropped', 'Destination is not in the hub');
        }
        if (r.nh === 'VirtualAppliance') {
          const a = A(r.via);
          if (!a || !a.enabled) { H(cur, cur, r, 'Next hop ' + r.ip + ' — no appliance is deployed at this address'); return fin('dropped', 'Next hop ' + r.ip + ' does not exist (appliance not deployed)'); }
          if (!linked(s)) { H(cur, cur, r, 'Next hop ' + r.ip + ' is in the hub, but the peering is not connected (access disabled on one side)'); return fin('dropped', 'Hub peering is not connected, next hop unreachable'); }
          H(cur, cur, r, 'UDR ' + r.prefix + ' sends the packet to ' + a.name + ' (' + a.ip + ')');
          go(r.via, cur); continue;
        }
        if (r.nh === 'VirtualNetworkGateway') {
          if (!linked(s)) { H(cur, cur, r, 'Gateway next hop needs the hub peering, which is not connected'); return fin('dropped', 'Hub peering is not connected'); }
          H(cur, cur, r, 'Route ' + r.prefix + ' (' + (r.src === 'BGP' ? 'learned from ExpressRoute via BGP' : 'UDR') + ') sends the packet to the ER gateway, then ExpressRoute — bypassing any firewall');
          nodes.push('gw'); go('msee', 'gw'); continue;
        }
        if (r.nh === 'Internet') {
          if (own.kind !== 'internet') { H(cur, cur, r, 'Private destination sent towards the Internet'); return fin('dropped', 'Private destination ' + dstIp + ' is not reachable via the Internet next hop'); }
          if (s.outbound) { H(cur, cur, r, 'System route 0.0.0.0/0 → Internet, using the explicit outbound method (NAT Gateway / public IP)'); nodes.push('internet'); return fin('delivered'); }
          H(cur, cur, r, 'System route 0.0.0.0/0 → Internet, but default outbound access is retired and there is no explicit outbound method (NAT Gateway, public IP, LB outbound rule) — DROPPED');
          return fin('dropped', 'No explicit outbound method: default outbound access is retired, so ' + s.name + ' has no Internet access');
        }
        if (r.nh === 'None') { H(cur, cur, r, 'Route ' + r.prefix + ' has next hop None — DROPPED'); return fin('dropped', 'Next hop None for ' + r.prefix + ' in ' + s.name); }
      }

      if (cur === 'fw' || cur === 'vnra') {
        const a = A(cur), r = lpm(T[cur].routes, dstIp);
        if (!a.allow) { H(cur, null, null, a.name + ' policy denies this traffic'); return fin('dropped', a.name + ' policy denies the traffic'); }
        if (!r) { H(cur, cur, null, 'No matching route'); return fin('dropped', 'No route at ' + a.name); }
        if (r.nh === 'VNetPeering') {
          const s = scn.spokes[r.to];
          if (!s.peerToHub.fwd) { H(cur, cur, r, a.name + ' forwards over the peering, but the spoke peering has Allow forwarded traffic OFF — DROPPED'); return fin('dropped', s.name + ' peering: forwarded traffic is not allowed'); }
          H(cur, cur, r, a.name + ' forwards over the hub-spoke peering'); nodes.push(r.to);
          return fin('delivered');
        }
        if (r.nh === 'VnetLocal') { H(cur, cur, r, 'Delivered inside the hub'); nodes.push('hub'); return fin('delivered'); }
        if (r.nh === 'VirtualNetworkGateway') { H(cur, cur, r, a.name + ' learned ' + r.prefix + ' from the gateway — forwarded to ExpressRoute'); nodes.push('gw'); go('msee', 'gw'); continue; }
        if (r.nh === 'Internet') {
          if (own.kind !== 'internet') { H(cur, cur, r, 'Private destination sent towards the Internet'); return fin('dropped', 'Private destination ' + dstIp + ' not reachable via Internet at ' + a.name); }
          H(cur, cur, r, a.snat ? a.name + ' SNATs to its public IP and sends to the Internet' : a.name + ' sends the packet to the Internet'); nodes.push('internet'); snat = a.snat; return fin('delivered');
        }
        if (r.nh === 'VirtualAppliance') { const b = A(r.via); if (!b || !b.enabled || r.via === cur) return fin('dropped', 'Invalid appliance chain'); H(cur, cur, r, 'UDR ' + rname(r) + ' chains to ' + b.name); go(r.via, cur); continue; }
        H(cur, cur, r, 'Dropped: ' + r.prefix + ' → ' + r.nh); return fin('dropped', 'Next hop ' + r.nh + ' for ' + r.prefix + ' at ' + a.name);
      }

      if (cur === 'msee') {
        const r = lpm(T.msee.routes, dstIp);
        if (!r) { H('msee', 'msee', null, 'No route on the MSEE'); return fin('dropped', 'No route on the MSEE'); }
        const others = matches(T.msee.routes, dstIp).filter(x => x !== r && x.state === 'Active').map(x => x.prefix + ' (' + (x.nh === 'OnPrem' ? 'on-prem' : 'Azure') + ')');
        if (r.nh === 'Azure') {
          H('msee', 'msee', r, 'MSEE has ' + r.prefix + ' advertised by Azure' + (others.length ? ' and also ' + others.join(', ') + ' — longest prefix wins, so the packet is sent back into Azure' : ' — sent back into Azure'));
          nodes.push('gw'); cur = 'gw'; from = 'msee'; continue;
        }
        H('msee', 'msee', r, 'Forwarded over the circuit to the on-prem CE routers (' + r.prefix + ')'); nodes.push('onprem'); cur = 'onprem'; from = 'msee'; continue;
      }

      if (cur === 'gw') {
        const r = lpm(T.gw.routes, dstIp);
        if (!r) { H('gw', 'gw', null, 'No matching route'); return fin('dropped', 'No route at GatewaySubnet'); }
        if (r.nh === 'VNetPeering') { H('gw', 'gw', r, 'ER gateway delivers straight to the spoke over the peering'); nodes.push(r.to); return fin('delivered'); }
        if (r.nh === 'VirtualAppliance') { const a = A(r.via); if (!a || !a.enabled) { H('gw', 'gw', r, 'Next hop ' + r.ip + ' — no appliance deployed'); return fin('dropped', 'GatewaySubnet next hop ' + r.ip + ' does not exist'); } H('gw', 'gw', r, 'GatewaySubnet UDR ' + r.prefix + ' sends the packet to ' + a.name); go(r.via, 'gw'); continue; }
        if (r.nh === 'VnetLocal') { H('gw', 'gw', r, 'Delivered inside the hub'); nodes.push('hub'); return fin('delivered'); }
        const dpr = scn.hub.gw.rt.disablePeering;
        H('gw', 'gw', r, dpr ? 'Peering routes are DISABLED on the GatewaySubnet route table and no UDR covers ' + dstIp + ' — only ' + rname(r) + ' is left: DROPPED' : 'Dropped: ' + rname(r));
        return fin('dropped', dpr ? 'GatewaySubnet: peering routes disabled and no replacement route for ' + dstIp : 'No usable route at GatewaySubnet for ' + dstIp);
      }

      if (cur === 'onprem') {
        const r = lpm(T.onprem.routes, dstIp);
        if (!r) { H('onprem', 'onprem', null, 'No route'); return fin('dropped', 'On-prem has no route for ' + dstIp); }
        if (r.nh === 'Local') {
          if (own.kind === 'onprem') { H('onprem', 'onprem', r, 'Delivered on-prem'); return fin('delivered'); }
          H('onprem', 'onprem', r, 'Connected network, but nothing owns this address'); return fin('dropped', 'No host for ' + dstIp);
        }
        if (r.nh === 'ExpressRoute') { H('onprem', 'onprem', r, 'On-prem router sends ' + r.prefix + ' over ExpressRoute'); go('msee', 'onprem'); continue; }
        if (r.nh === 'Null0') { H('onprem', 'onprem', r, 'Only the on-prem aggregate ' + r.prefix + ' matches (Null0) — DROPPED; Azure does not advertise a more specific route for ' + dstIp); return fin('dropped', 'On-prem has no specific route for ' + dstIp + ' (aggregate ' + r.prefix + ' → Null0)'); }
        if (r.nh === 'LocalInternetEdge') {
          if (own.kind === 'internet') { H('onprem', 'onprem', r, 'On-prem default route to the local Internet edge'); nodes.push('internet'); return fin('delivered'); }
          H('onprem', 'onprem', r, 'Follows the on-prem default route to the local Internet edge — private destination unreachable'); return fin('dropped', 'On-prem has no route for ' + dstIp);
        }
      }
      return fin('dropped', 'Unexpected state at ' + cur);
    }
    return fin('dropped', 'Routing loop detected');
  }

  /* ---------- Analysis ---------- */
  function analyze(scn, T, f) {
    const own = owner(scn, f.dstIp), so = owner(scn, f.srcIp);
    const fwd = walk(scn, T, f.src, f.srcIp, f.dstIp);
    let ret = null;
    if (fwd.status === 'delivered') {
      if (own.kind === 'internet') ret = { status: 'delivered', reason: '', nodes: fwd.nodes.slice().reverse(), hops: [{ node: 'internet', table: null, route: null, text: 'Reply returns along the same path (stateful return traffic)', cands: [] }] };
      else if (own.kind === 'spoke') ret = walk(scn, T, own.id, f.dstIp, f.srcIp);
      else if (own.kind === 'onprem') ret = walk(scn, T, 'onprem', f.dstIp, f.srcIp);
    }
    const I = [];
    if (fwd.status === 'dropped') I.push({ tag: 'Dropped', level: 'error', title: 'Request dropped', text: fwd.reason });
    else if (ret && ret.status === 'dropped') I.push({ tag: 'Dropped', level: 'error', title: 'Reply dropped', text: ret.reason });
    if (own.kind === 'internet' && fwd.status === 'dropped' && /default outbound/.test(fwd.reason)) I.push({ tag: 'NoEgress', level: 'error', title: 'No Internet egress', text: 'Default outbound access is retired. Give the subnet an explicit outbound method (NAT Gateway, public IP, load balancer outbound rule) or a route to an appliance that provides it.' });
    const apps = n => APPS.filter(x => n.includes(x));
    if (ret && fwd.status === 'delivered' && ret.status === 'delivered' && own.kind !== 'internet') {
      const a = apps(fwd.nodes), b = apps(ret.nodes);
      a.concat(b).filter((x, i, arr) => arr.indexOf(x) === i && (a.includes(x) !== b.includes(x))).forEach(id => {
        const ap = scn.hub.appliances[id];
        I.push(id === 'fw'
          ? { tag: 'Asymmetric', level: 'error', title: 'Asymmetric routing via ' + ap.name, text: 'Only one direction passes the stateful firewall, so it sees half a session and drops it. Make both directions use the same inspection point (UDRs on both the spokes and the GatewaySubnet).' }
          : { tag: 'Asymmetric', level: 'warn', title: 'Asymmetric path via ' + ap.name, text: 'Request and reply use different paths. A pure forwarder tolerates this, an inspecting firewall would not.' });
      });
    }
    const viaEr = fwd.nodes.includes('msee') || (ret && ret.nodes.includes('msee'));
    if (viaEr && so.kind !== 'onprem' && own.kind !== 'onprem' && fwd.status === 'delivered') {
      I.push({ tag: 'Hairpin', level: 'warn', title: 'ExpressRoute hairpin', text: 'Traffic between two Azure VNets leaves Azure, turns around on the MSEE and comes back through the ER gateway. It adds latency, consumes circuit bandwidth and is not inspected. Cause: on-prem advertises a range covering the spokes, and there is no peering between the spokes. Fix: a UDR for the summary range on the spokes (to the firewall or VNRA), or stop advertising the spoke range from on-prem.' });
    }
    const seenBp = {};
    fwd.hops.forEach(h => {
      if (!h.route || h.route.src !== 'Default' || !(h.route.nh === 'VNetPeering' || h.route.nh === 'VnetLocal') || !T[h.table]) return;
      const u = T[h.table].routes.find(x => x.state === 'Active' && x.src === 'User' && x.nh === 'VirtualAppliance' && maskLen(x.prefix) > 0 && maskLen(x.prefix) < maskLen(h.route.prefix) && contains(x.prefix, f.dstIp));
      if (u && !seenBp[h.table]) { seenBp[h.table] = 1; I.push({ tag: 'PeerBypass', level: 'warn', title: 'UDR bypassed by a more specific route', text: 'In ' + nodeName(scn, h.node) + ' the system route ' + h.route.prefix + ' is more specific than the UDR ' + u.prefix + ' → ' + nodeName(scn, u.via) + ', so ' + f.dstIp + ' skips the appliance. Use a UDR with an equal or longer prefix, or disable peering route propagation on that route table.' }); }
    });
    if (own.kind === 'internet' && fwd.status === 'delivered' && scn.hub.appliances.fw.enabled && !fwd.nodes.includes('fw'))
      I.push({ tag: 'Bypass', level: 'warn', title: 'Internet egress is not inspected', text: 'The path to the Internet does not pass the Azure Firewall.' });

    const inspected = fwd.nodes.includes('fw');
    const level = I.some(i => i.level === 'error') ? 'error' : I.some(i => i.level === 'warn') ? 'warn' : 'ok';
    return { fwd, ret, issues: I, verdict: level, inspected, srcOwner: so, dstOwner: own };
  }

  /* ---------- Validation ---------- */
  function validate(scn) {
    const W = [];
    const chk = (label, v) => { if (!parseCidr(v)) W.push({ level: 'error', msg: label + ': "' + v + '" is not a valid CIDR' }); };
    chk('Hub address space', scn.hub.cidr);
    chk('Gateway subnet', scn.hub.gw.cidr);
    APPS.forEach(id => { const a = scn.hub.appliances[id]; if (a.enabled) { chk(a.name + ' subnet', a.cidr); if (ip2n(a.ip) == null) W.push({ level: 'error', msg: a.name + ': invalid IP' }); else if (!contains(a.cidr, a.ip)) W.push({ level: 'error', msg: a.name + ': IP ' + a.ip + ' is outside its subnet ' + a.cidr }); } });
    SPOKES.forEach(id => { const s = scn.spokes[id]; chk(s.name + ' address space', s.cidr); if (parseCidr(s.cidr) && !contains(s.cidr, s.vm)) W.push({ level: 'warn', msg: s.name + ': VM IP ' + s.vm + ' is outside ' + s.cidr }); });
    const sub = [['Gateway subnet', scn.hub.gw.cidr]].concat(APPS.filter(id => scn.hub.appliances[id].enabled).map(id => [scn.hub.appliances[id].name + ' subnet', scn.hub.appliances[id].cidr]));
    sub.forEach(([n, c]) => { if (parseCidr(c) && parseCidr(scn.hub.cidr) && !covers(scn.hub.cidr, c)) W.push({ level: 'error', msg: n + ' ' + c + ' is not inside the hub address space ' + scn.hub.cidr }); });
    for (let i = 0; i < sub.length; i++) for (let j = i + 1; j < sub.length; j++) if (overlaps(sub[i][1], sub[j][1])) W.push({ level: 'error', msg: sub[i][0] + ' overlaps ' + sub[j][0] });
    const spaces = [['Hub', scn.hub.cidr]].concat(SPOKES.map(id => [scn.spokes[id].name, scn.spokes[id].cidr])).concat(connected(scn).map(c => ['On-prem network', c]));
    for (let i = 0; i < spaces.length; i++) for (let j = i + 1; j < spaces.length; j++) if (overlaps(spaces[i][1], spaces[j][1])) W.push({ level: 'error', msg: 'Overlapping address spaces: ' + spaces[i][0] + ' ' + spaces[i][1] + ' and ' + spaces[j][0] + ' ' + spaces[j][1] + ' (peering and ExpressRoute need non-overlapping ranges)' });
    const pn = parseList(scn.onprem.networks), pa = parseList(scn.onprem.advertise);
    if (pn.bad.length) W.push({ level: 'error', msg: 'On-prem networks: invalid CIDR ' + pn.bad.join(', ') });
    if (pa.bad.length) W.push({ level: 'error', msg: 'Advertised prefixes: invalid CIDR ' + pa.bad.join(', ') });
    if (!pn.ok.length) W.push({ level: 'warn', msg: 'On-prem has no connected network' });
    return W;
  }

  /* ---------- Presets ---------- */
  function rt(s, prefix, nh) { s.routes = s.routes.filter(r => r.prefix !== prefix); s.routes.push({ prefix, nh }); }
  const via = (s, nh, rfc) => {
    SPOKES.forEach(id => { if (rfc) RFC1918.forEach(p => rt(s.spokes[id].rt, p, nh)); else s.spokes[id].rt.propagate = false; rt(s.hub.gw.rt, parseCidr(s.spokes[id].cidr).str, nh); });
  };
  const presets = [
    { id: 'fw-all', name: '✔ Private (incl. on-prem) and Public over Azure Firewall', desc: 'Spoke route tables have Propagate gateway routes disabled, so the default route 0.0.0.0/0 → firewall is all they need; the GatewaySubnet sends the spoke ranges to the firewall. Spoke ↔ spoke, spoke ↔ on-prem and Internet are all inspected, both directions.', apply: s => { via(s, 'fw'); return s; } },
    { id: 'fw-public-gw-private', name: '✔ Public over Azure Firewall, private via gateway (no spoke-to-spoke)', desc: 'On-prem advertises only a small, non-overlapping range (192.168.10.0/24), so spokes reach on-prem directly through the ER gateway. Only 0.0.0.0/0 goes to the firewall. There is no spoke-to-spoke route; the only path between spokes is the default route through the firewall.', apply: s => { s.onprem.networks = '192.168.10.0/24'; s.onprem.advertise = '192.168.10.0/24'; return s; } },
    { id: 'vnra-private', name: '✔ Public over Azure Firewall, private (incl. on-prem) over VNRA', desc: 'Spokes send RFC1918 to the VNRA and 0.0.0.0/0 to the firewall; the GatewaySubnet sends the spoke ranges to the VNRA. The VNRA forwards without SNAT, so both directions stay symmetric.', apply: s => { s.hub.appliances.vnra.enabled = true; via(s, 'vnra', true); return s; } },
    { id: 'vnra-all', name: '✔ Private (incl. on-prem) and Public over VNRA, VNRA default route to firewall', desc: 'Spoke route tables have Propagate gateway routes disabled, so 0.0.0.0/0 → VNRA is all they need. The VNRA subnet has 0.0.0.0/0 → firewall, so Internet traffic is inspected and private traffic is only forwarded.', apply: s => { s.hub.appliances.vnra.enabled = true; via(s, 'vnra'); SPOKES.forEach(id => rt(s.spokes[id].rt, '0.0.0.0/0', 'vnra')); rt(s.hub.appliances.vnra.rt, '0.0.0.0/0', 'fw'); return s; } },
    { id: 'bad-asym-fw', name: '✖ Asymmetric traffic over Azure Firewall (spoke ↔ spoke)', desc: 'Only spoke 1 sends the spoke range to the firewall. The reply from spoke 2 follows the BGP summary over ExpressRoute and skips the firewall, which sees half a session.', apply: s => { rt(s.spokes.spoke1.rt, supernet([s.hub.cidr, s.spokes.spoke1.cidr, s.spokes.spoke2.cidr]), 'fw'); return s; } },
    { id: 'bad-hairpin', name: '✖ Hairpin over ER MSEE (on-prem advertises RFC1918)', desc: 'Spokes only have 0.0.0.0/0 → firewall. The RFC1918 BGP routes are more specific, so spoke ↔ spoke traffic leaves Azure, turns around on the MSEE and comes back.', apply: s => s },
    { id: 'bad-asym-onprem', name: '✖ Asymmetric traffic to on-prem (one leg over Azure Firewall)', desc: 'Spokes send on-prem traffic to the firewall, but the GatewaySubnet delivers the return traffic straight over the peering, skipping the firewall.', apply: s => { SPOKES.forEach(id => connected(s).forEach(c => rt(s.spokes[id].rt, c, 'fw'))); return s; } }
  ];  function applyPreset(id) {
    const p = presets.find(x => x.id === id) || presets[0];
    const s = p.apply(defaultScenario());
    s.name = p.name;
    return s;
  }

  return { RFC1918, ip2n, n2ip, parseCidr, parseList, supernet, hostIn, contains, covers, overlaps, maskLen, defaultScenario, normalize, clone, buildTables, matches, lpm, owner, walk, analyze, validate, presets, applyPreset, nodeName, linked, usesGw, advert, connected, SPOKES, APPS };
});
