// Headless validation of the routing engine in index.html (no DOM needed).
// Usage: node tests/validate.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
const engine = script.slice(0, script.indexOf("const $=id=>"));
const ctx = vm.createContext({});
vm.runInContext(engine + `
this.api={cfg,BASE,buildTables,analyze,get TABLES(){return TABLES;}};`, ctx);
const { cfg, BASE, buildTables, analyze } = ctx.api;

let failed = 0;
function reset(over) { Object.assign(cfg, BASE, over || {}); buildTables(); }
function tags(s, d) { return analyze(s, d).W.map(w => w.tag); }
function check(name, cond) { if (!cond) failed++; console.log((cond ? 'PASS ' : 'FAIL ') + name); }
const has = (s, d, t) => tags(s, d).includes(t);
const delivered = (s, d) => { const a = analyze(s, d); return a.f.status === 'delivered' && (!a.r || a.r.status === 'delivered'); };
const fwdNodes = (s, d) => analyze(s, d).f.nodes;

try {
  const a = analyze('spoke1', 'onprem');
  console.log('analyze keys:', Object.keys(a).join(','), '| f keys:', Object.keys(a.f || {}).join(','));
} catch (e) { console.log('probe error', e.message); }

reset();
check('baseline spoke1->spoke2 hairpins', has('spoke1', 'spoke2', 'Hairpin'));
check('baseline spoke1->onprem delivered', delivered('spoke1', 'onprem'));
check('baseline onprem->spoke1 delivered', delivered('onprem', 'spoke1'));
check('baseline spoke1->internet via fw', fwdNodes('spoke1', 'internet').includes('fw') && delivered('spoke1', 'internet'));

reset({ gwSummary: true });
check('summary alone -> PeerBypass', has('onprem', 'spoke1', 'PeerBypass') && !fwdNodes('onprem', 'spoke1').includes('fw'));
reset({ gwSummary: true, dprGw: true });
check('summary+DPR via fw', fwdNodes('onprem', 'spoke1').includes('fw') && delivered('onprem', 'spoke1') && !has('onprem', 'spoke1', 'PeerBypass'));
reset({ dprGw: true });
check('DPR alone drops', analyze('onprem', 'spoke1').f.status === 'dropped');
check('DPR removes gw peering routes', !ctx.api.TABLES.gw.routes.some(r => r.nh === 'VNetPeering'));

reset({ dprGw: true, dprDefFw: true });
check('DPR + default->FW: onprem->spoke via fw', fwdNodes('onprem', 'spoke1').includes('fw') && delivered('onprem', 'spoke1'));
reset({ dprGw: true, dprDefVnra: true, vnra: true });
check('DPR + default->VNRA: onprem->spoke via vnra', fwdNodes('onprem', 'spoke1').includes('vnra') && delivered('onprem', 'spoke1'));
reset({ udrOnpremToFw: true });
check('192.168/16->FW asymmetry', has('spoke1', 'onprem', 'Asymmetric'));

reset();
check('baseline spoke1->spoke2 hairpins', has('spoke1', 'spoke2', 'Hairpin'));
reset({ erPfx: '192.168.0.0/16' });
check('custom ER prefix 192.168/16 only: no hairpin', !has('spoke1', 'spoke2', 'Hairpin'));
check('custom ER prefix 192.168/16 only: spoke->onprem still works', delivered('spoke1', 'onprem') || analyze('spoke1', 'onprem').f.status === 'delivered');
reset({ erPfx: '192.168.0.0/16, 192.168.0.0/16, junk, 300.1.1.1/8' });
check('invalid and duplicate CIDRs ignored', !has('spoke1', 'spoke2', 'Hairpin'));
reset({ spokeAccess: false });
check('spoke access off: spoke1->onprem dropped', analyze('spoke1', 'onprem').f.status === 'dropped');
reset({ hubAccess: false });
check('hub access off: onprem->spoke1 dropped', analyze('onprem', 'spoke1').f.status === 'dropped');
reset({ hubGwTransit: false });
check('gateway transit off: spoke gets no ER routes', analyze('spoke1', 'onprem').f.status === 'dropped' || has('spoke1', 'onprem', 'Dropped'));
reset({ spokeFwd: false, udrSpokeToFw: true });
check('spoke forwarded traffic off: fw->spoke dropped', analyze('spoke2', 'spoke1').f.status === 'dropped');

console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
process.exit(failed ? 1 : 0);
