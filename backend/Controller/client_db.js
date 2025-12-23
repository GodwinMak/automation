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

// ---------------------------------------------------
// Get Client DB by CID
// ---------------------------------------------------
exports.getByCid = async (req, res) => {
  const { cid } = req.params;
  
  try {
    const record = await client_db.findOne({
      where: { network_cid: cid }
    });
    
    if (!record) {
      return res.status(404).json({ message: "Client DB record not found for this CID" });
    }
    
    res.status(200).json(record);
  } catch (error) {
    console.error("Error fetching client_db by CID:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ---------------------------------------------------
// Update Client DB record
// Works for DIA, IPT, and Shared customers
// ---------------------------------------------------
exports.updateClientDb = async (req, res) => {
  const { cid } = req.params;
  const {
    email_address,
    phone_number,
    onnet_offnet,
    customer_name_pastel,
    area,
    first_name,
    special_comments,
    medium_details,
    revenue_head,
    provider,
    new_customer_type,
  } = req.body;

  try {
    // Find existing record by CID
    let record = await client_db.findOne({
      where: { network_cid: cid }
    });

    if (record) {
      // Update existing record
      await record.update({
        email_address: email_address !== undefined ? email_address : record.email_address,
        phone_number: phone_number !== undefined ? phone_number : record.phone_number,
        onnet_offnet: onnet_offnet !== undefined ? onnet_offnet : record.onnet_offnet,
        customer_name_pastel: customer_name_pastel !== undefined ? customer_name_pastel : record.customer_name_pastel,
        area: area !== undefined ? area : record.area,
        first_name: first_name !== undefined ? first_name : record.first_name,
        special_comments: special_comments !== undefined ? special_comments : record.special_comments,
        medium_details: medium_details !== undefined ? medium_details : record.medium_details,
        revenue_head: revenue_head !== undefined ? revenue_head : record.revenue_head,
        provider: provider !== undefined ? provider : record.provider,
        new_customer_type: new_customer_type !== undefined ? new_customer_type : record.new_customer_type,
      });

      res.status(200).json({
        message: "Client DB updated successfully",
        data: record
      });
    } else {
      // Create new record if doesn't exist
      record = await client_db.create({
        network_cid: cid,
        email_address,
        phone_number,
        onnet_offnet,
        customer_name_pastel,
        area,
        first_name,
        special_comments,
        medium_details,
        revenue_head,
        provider,
        new_customer_type,
      });

      res.status(201).json({
        message: "Client DB created successfully",
        data: record
      });
    }
  } catch (error) {
    console.error("Error updating client_db:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ---------------------------------------------------
// Create Client DB record
// ---------------------------------------------------
exports.createClientDb = async (req, res) => {
  const {
    network_cid,
    email_address,
    phone_number,
    onnet_offnet,
    customer_name_pastel,
    area,
    first_name,
    special_comments,
    medium_details,
    revenue_head,
    provider,
    new_customer_type,
  } = req.body;

  if (!network_cid) {
    return res.status(400).json({ message: "network_cid is required" });
  }

  try {
    // Check if already exists
    const existing = await client_db.findOne({
      where: { network_cid }
    });

    if (existing) {
      return res.status(409).json({ message: "Client DB record already exists for this CID" });
    }

    const record = await client_db.create({
      network_cid,
      email_address,
      phone_number,
      onnet_offnet,
      customer_name_pastel,
      area,
      first_name,
      special_comments,
      medium_details,
      revenue_head,
      provider,
      new_customer_type,
    });

    res.status(201).json({
      message: "Client DB created successfully",
      data: record
    });
  } catch (error) {
    console.error("Error creating client_db:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ---------------------------------------------------
// Delete Client DB record
// ---------------------------------------------------
exports.deleteClientDb = async (req, res) => {
  const { cid } = req.params;

  try {
    const record = await client_db.findOne({
      where: { network_cid: cid }
    });

    if (!record) {
      return res.status(404).json({ message: "Client DB record not found" });
    }

    await record.destroy();

    res.status(200).json({ message: "Client DB deleted successfully" });
  } catch (error) {
    console.error("Error deleting client_db:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ---------------------------------------------------
// Get all Client DB records (with pagination)
// ---------------------------------------------------
exports.getAllClientDb = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const offset = (page - 1) * pageSize;
  const searchQuery = req.query.search || "";

  try {
    const { count, rows } = await client_db.findAndCountAll({
      offset,
      limit: pageSize,
      where: {
        [db.Sequelize.Op.or]: [
          { customer_name_pastel: { [db.Sequelize.Op.like]: `%${searchQuery}%` } },
          { network_cid: { [db.Sequelize.Op.like]: `%${searchQuery}%` } },
          { email_address: { [db.Sequelize.Op.like]: `%${searchQuery}%` } },
        ]
      },
      order: [['createdAt', 'DESC']]
    });

    const totalPages = Math.ceil(count / pageSize);

    res.status(200).json({
      data: rows,
      totalItems: count,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error("Error fetching client_db records:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};