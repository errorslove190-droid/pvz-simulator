import { chromium } from 'playwright';
for (const [label, args, host, src] of [
  ['localhost-host', [], 'http://localhost:8802/__host.html', 'http://localhost:8812/?adMs=300'],
  ['host.test+flags', ['--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks'], 'http://host.test/', 'http://localhost:8812/?adMs=300'],
]) {
  const b = await chromium.launch({ args });
  const page = await b.newPage();
  await page.route(host, (r) => r.fulfill({ contentType: 'text/html', body: `<body style="height:3000px"><iframe id="g" src="${src}" style="width:1280px;height:600px;border:0"></iframe></body>` }));
  await page.goto(host);
  await page.waitForTimeout(2500);
  console.log(label, page.frames().map(f => f.url()));
  await b.close();
}
