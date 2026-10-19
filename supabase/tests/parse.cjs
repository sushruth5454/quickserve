const fs = require('fs');
const lib = require('libpg-query');
(async () => {
  const file = process.argv[2] || require('path').join(__dirname, '..', 'migrations', '0001_init.sql');
  const sql = fs.readFileSync(file, 'utf8');
  if (lib.loadModule) await lib.loadModule();
  const parse = lib.parse || lib.parseQuery;
  const res = await parse(sql);
  console.log('top-level statements:', res.stmts.length);
  let bodies = 0, errs = 0;
  for (const s of res.stmts) {
    const cf = s.stmt.CreateFunctionStmt;
    if (!cf) continue;
    const lang = cf.options.find(o => o.DefElem.defname === 'language').DefElem.arg.String.sval;
    const body = cf.options.find(o => o.DefElem.defname === 'as').DefElem.arg.List.items[0].String.sval;
    const name = cf.funcname.map(n => n.String.sval).join('.');
    try {
      if (lang === 'plpgsql') {
        const full = Buffer.from(sql).subarray(s.stmt_location||0, (s.stmt_location||0) + (s.stmt_len||sql.length)).toString();
        await (lib.parsePlPgSQL)(full);
      } else {
        await parse(body);
      }
      bodies++;
    } catch (e) { errs++; console.log('ERR in', name, e.message); }
  }
  console.log('function bodies ok:', bodies, 'errors:', errs);
  if (errs) process.exit(1);
})().catch(e => { console.error('PARSE ERROR', e.message, e.cursorPosition); process.exit(1); });

