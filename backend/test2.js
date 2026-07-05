const sql = require('mssql');
const { InteractiveBrowserCredential } = require('@azure/identity');

let cachedToken = null;
let tokenExpiresOn = null;

async function getAccessToken() {
  const now = Date.now();

  // Reuse cached token if still valid (with 5 min buffer before expiry)
  if (cachedToken && tokenExpiresOn && now < tokenExpiresOn - 5 * 60 * 1000) {
    console.log('Using cached token');
    return cachedToken;
  }

  console.log('Token expired or missing — requesting new one (browser will open)...');
  const credential = new InteractiveBrowserCredential({ tenantId: '68792612-0f0e-46cb-b16a-fcb82fd80cb1' });
  const tokenResponse = await credential.getToken('https://database.windows.net/.default');

  cachedToken = tokenResponse.token;
  tokenExpiresOn = tokenResponse.expiresOnTimestamp; // epoch ms
  return cachedToken;
}

async function runQuery(queryString) {
  const accessToken = await getAccessToken();

  const config = {
    server: 'ciths2aob7funmlk7s4c7wamwe-fiaxm76ya27ure7qf6atw4ih2q.datawarehouse.fabric.microsoft.com',
    database: 'Liquid_Tanzania_Lakehouse',
    authentication: {
      type: 'azure-active-directory-access-token',
      options: { token: accessToken }
    },
    options: { encrypt: true }
  };

  const pool = await sql.connect(config);
  const result = await pool.request().query(queryString);
  await pool.close();
  return result.recordset;
}

// Example: run multiple queries without re-prompting browser, as long as within token lifetime
(async () => {
  const data1 = await runQuery(`SELECT * FROM prism.ppp_username WHERE CustomerID LIKE 'LHTZ%'`);
  console.log(data1);

  const data2 = await runQuery(`SELECT * FROM prism.active_churn_retail WHERE CustomerID LIKE 'LHTZ%'`);
  console.log(data2);
})().catch(console.error);