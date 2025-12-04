const XLSX = require("xlsx");
const path = require("path");
const db = require("../Models");


const client_db = db.client_dbs;

// ---------------------------------------------------
// Upload & Insert Excel File in Bulk
// ---------------------------------------------------

exports.uploadBillingFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const filePath = path.join(__dirname, "..", "uploads", req.file.filename);

    // Read the Excel file  
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    // Convert sheet to JSON
    const rows = XLSX.utils.sheet_to_json(sheet);

    // Format rows to match Sequelize table
    const formattedRows = rows.map((row) => ({
      area: row.AREA || null,
      customer_name_pastel: row.Customer_Name_Pastel || null,
      customer_other_name_pastel: row.Customer_Other_Name_Pastel || null,
      first_name: row.First_Name || null,
      phone_number: row.Phone_Number || null,
      email_address: row.Email_Address || null,
      new_customer_type: row.New_Customer_Type || null,
      special_comments: row.Special_Comments || null,
      medium_details: row.Medium_Details || null,
      revenue_head: row.Revenue_Head || null,
      mbps_seats: row.Mbps_Seats || null,
      mbps_network_configuratons: row.Mbps_Network_Configuratons || null,
      network_cid: row.Network_CID || null,
      onnet_offnet: row.Onnet_Offnet || null,
      provider: row.Provider || null,
    }));

    // Bulk insert
    await client_db.bulkCreate(formattedRows);

    res.status(200).json({
      message: "Billing file imported successfully",
      inserted: formattedRows.length,
    });

  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};


exports.update = async (req, res)=>{
  
}