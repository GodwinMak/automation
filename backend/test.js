const sql = require('mssql');
const { InteractiveBrowserCredential } = require('@azure/identity');

async function getAccessToken() {
  console.log('Creating credential...');
  const credential = new InteractiveBrowserCredential({
    tenantId: '68792612-0f0e-46cb-b16a-fcb82fd80cb1'
  });

  console.log('Requesting token (browser should open)...');
  const tokenResponse = await credential.getToken('https://database.windows.net/.default');
  console.log('Token acquired:', tokenResponse.token.substring(0, 20) + '...');
  return tokenResponse.token;
}

async function queryFabric() {
  try {
    const accessToken = await getAccessToken();
    console.log('Connecting to SQL...');

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
    console.log('Connected. Running query...');

    const result = await pool.request().query(`
      SELECT *
FROM (
    SELECT 
        p.CustomerID,
        p.CustomerName,
        p.ServiceType,
        p.PPPUserName,
        a.EMailAddress,
        a.HomeNumber,
        a.Address,
        a.EndDate,
        a.ValidityPeriod,
        ROW_NUMBER() OVER (PARTITION BY p.CustomerID ORDER BY a.EndDate DESC) AS rn
    FROM prism.ppp_username p
    LEFT JOIN prism.active_churn_retail a 
        ON p.CustomerID = a.CustomerID
    WHERE p.CustomerID LIKE 'LHTZ%' AND PPPUserName LIKE '%liquidtelecom%'
        AND a.EndDate IS NOT NULL
) t
WHERE rn = 1
ORDER BY CustomerID ASC
    `);
    console.log('Results:', result.recordset);
    await pool.close();
  } catch (err) {
    console.error('ERROR CAUGHT:', err);
  }
}

queryFabric();

// catch anything that slips through
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});