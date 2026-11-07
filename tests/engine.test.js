const RS = require('../v2/engine.js');
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
const run = (s, f) => { const T = RS.buildTables(s); return RS.analyze(s, T, Object.assign({}, s.flow, f)); };
const tags = a => a.issues.map(i => i.tag);

let s = RS.defaultScenario();
let a = run(s);
ok(a.fwd.status === 'delivered' && tags(a).includes('Hairpin'), 'baseline spoke1->spoke2 hairpins over ER');

s = RS.applyPreset('fixhairpin'); a = run(s);
ok(a.fwd.nodes.includes('fw') && !tags(a).includes('Hairpin'), 'summary UDR sends spoke-spoke via firewall');

s = RS.applyPreset('onlyconnected'); a = run(s);
ok(a.fwd.status === 'dropped' || !tags(a).includes('Hairpin'), 'advertise only connected range removes hairpin');

s = RS.defaultScenario(); s.hub.cidr = '10.10.0.0/24'; s.hub.gw.cidr = '10.10.0.0/26';
s.hub.appliances.fw.cidr = '10.10.0.64/26'; s.hub.appliances.fw.ip = '10.10.0.68';
s.spokes.spoke1.cidr = '10.10.1.0/24'; s.spokes.spoke2.cidr = '10.10.2.0/24';
s.spokes.spoke1.vm = '10.10.1.10'; s.spokes.spoke2.vm = '10.10.2.10';
a = run(s, { srcIp: '10.10.1.10', dstIp: '10.10.2.10' });
ok(a.fwd.status === 'delivered' && RS.validate(s).length === 0, 'custom 10.10.x ranges work');

s = RS.defaultScenario(); s.spokes.spoke1.peerToHub.access = false;
a = run(s, { dstIp: '192.168.10.10' });
ok(a.fwd.status === 'dropped', 'peering access off drops');

s = RS.defaultScenario(); s.spokes.spoke1.peerToHub.fwd = true; s.spokes.spoke2.peerToHub.fwd = false;
a = run(s, { src: 'spoke1', dstIp: '172.16.2.10' });
s = RS.applyPreset('fixhairpin'); s.spokes.spoke2.peerToHub.fwd = false; a = run(s);
ok(a.fwd.status === 'dropped', 'forwarded traffic off drops at spoke peering');

s = RS.applyPreset('dpr'); a = run(s, { src: 'onprem', srcIp: '192.168.10.10', dstIp: '172.16.1.10' });
ok(a.fwd.nodes.includes('fw'), 'DPR + summary routes on-prem->spoke via firewall');

s = RS.applyPreset('asym'); a = run(s, { dstIp: '192.168.10.10' });
ok(tags(a).includes('Asymmetric'), 'asymmetric detected');

s = RS.defaultScenario(); a = run(s, { dstIp: '20.50.60.70' });
ok(a.fwd.status === 'delivered' && a.inspected, 'internet via firewall');
s = RS.applyPreset('noroute'); a = run(s, { dstIp: '20.50.60.70' });
ok(a.fwd.status === 'dropped' && tags(a).includes('NoEgress'), 'no egress without default route');
s = RS.applyPreset('natgw'); a = run(s, { dstIp: '20.50.60.70' });
ok(a.fwd.status === 'delivered', 'NAT gw egress');

s = RS.defaultScenario(); s.hub.appliances.fw.enabled = false; a = run(s, { dstIp: '20.50.60.70' });
ok(a.fwd.status === 'dropped', 'firewall removed drops');

process.exit(fail ? 1 : 0);
