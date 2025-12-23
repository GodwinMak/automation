const XLSX = require("xlsx");
const db = require("../Models/index.js");
const Customer = db.diacustomers;
const IptCustomer = db.iptcustomers;
const SharedCustomer = db.sharedcustomers;

/**
 * Export DIA customers to Excel
 */
exports.exportDiaCustomers = async (req, res) => {
  try {
    const { status, nbr, search } = req.query;

    // Build where clause
    const where = {};
    if (status && status !== "all") {
      where.operationalStatus = status;
    }

    // Get customers with filters - query from customerinfos and include diacustomers
    const customerInfos = await db.customerinfos.findAll({
      where: nbr ? {
        nbr: {
          [db.Sequelize.Op.iLike]: `%${nbr}%`
        }
      } : undefined,
      include: [
        {
          model: db.diacustomers,
          where: status && status !== "all" ? { operationalStatus: status } : undefined,
          required: status && status !== "all" ? true : false,
        },
        {
          model: db.client_dbs,
          required: false
        }
      ]
    });

    // Filter by search if provided
    let filteredDiaCustomers = customerInfos;
    if (search) {
      filteredDiaCustomers = customerInfos.filter(customer =>
        customer.customerName?.toLowerCase().includes(search.toLowerCase()) ||
        customer.diacustomer?.interface?.toLowerCase().includes(search.toLowerCase()) ||
        customer.cid?.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Prepare data for Excel
    const excelData = filteredDiaCustomers.map(customer => ({
      "Customer Name": customer.customerName || "",
      "Interface": customer.diacustomer?.interface || "",
      "CID": customer.cid || "",
      "NBR": customer.nbr || "",
      "Status": customer.diacustomer?.operationalStatus || "",
      "Switch Name": customer.diacustomer?.switchName || "",
      "Capacity (Mbps)": customer.downmbps || customer.upmbps || "",
      "Upgrade Type": customer.upgrade_type === "temporary" ? "Temporary" : "Permanent",
      "Description": customer.diacustomer?.description || "",
      "Email": customer.client_db?.email_address || "",
      "Phone": customer.client_db?.phone_number || "",
      "Area": customer.client_db?.area || "",
      "Provider": customer.client_db?.provider || "",
      "Pastel Name": customer.client_db?.customer_name_pastel || "",
    }));

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    // Auto-size columns
    const colWidths = [
      { wch: 20 }, // Customer Name
      { wch: 15 }, // Interface
      { wch: 15 }, // CID
      { wch: 15 }, // NBR
      { wch: 10 }, // Status
      { wch: 20 }, // Switch Name
      { wch: 15 }, // Capacity
      { wch: 12 }, // Upgrade Type
      { wch: 30 }, // Description
      { wch: 25 }, // Email
      { wch: 15 }, // Phone
      { wch: 15 }, // Area
      { wch: 15 }, // Provider
      { wch: 20 }, // Pastel Name
    ];
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, "DIA Customers");

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `dia_customers_${status || 'all'}_${timestamp}.xlsx`;

    // Set headers for download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Write and send file
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);

  } catch (error) {
    console.error("Export DIA customers error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Export IPT customers to Excel
 */
exports.exportIptCustomers = async (req, res) => {
  try {
    const { status, nbr, search } = req.query;

    // Build where clause
    const where = {};
    if (status && status !== "all") {
      where.operationalStatus = status;
    }

    // Get customers with filters - query from iptcustomerinfos and include iptcustomers
    const iptCustomerInfos = await db.iptcustomerinfos.findAll({
      where: nbr ? {
        nbr: {
          [db.Sequelize.Op.iLike]: `%${nbr}%`
        }
      } : undefined,
      include: [
        {
          model: db.iptcustomers,
          where: status && status !== "all" ? { operationalStatus: status } : undefined,
          required: status && status !== "all" ? true : false,
        },
        {
          model: db.client_dbs,
          required: false
        }
      ]
    });

    // Filter by search if provided
    let filteredIptCustomers = iptCustomerInfos;
    if (search) {
      filteredIptCustomers = iptCustomerInfos.filter(customer =>
        customer.customerName?.toLowerCase().includes(search.toLowerCase()) ||
        customer.iptcustomer?.interface?.toLowerCase().includes(search.toLowerCase()) ||
        customer.cid?.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Prepare data for Excel
    const excelData = filteredIptCustomers.map(customer => ({
      "Customer Name": customer.customerName || "",
      "Interface": customer.iptcustomer?.interface || "",
      "CID": customer.cid || "",
      "NBR": customer.nbr || "",
      "Status": customer.iptcustomer?.operationalStatus || "",
      "Switch Name": customer.iptcustomer?.switchName || "",
      "Capacity (Mbps)": customer.iptcustomer?.capacity || "",
      "Upgrade Type": customer.upgrade_type === "temporary" ? "Temporary" : "Permanent",
      "Description": customer.iptcustomer?.description || "",
      "Email": customer.client_db?.email_address || "",
      "Phone": customer.client_db?.phone_number || "",
      "Area": customer.client_db?.area || "",
      "Provider": customer.client_db?.provider || "",
      "Pastel Name": customer.client_db?.customer_name_pastel || "",
    }));

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    // Auto-size columns
    const colWidths = [
      { wch: 20 }, // Customer Name
      { wch: 15 }, // Interface
      { wch: 15 }, // CID
      { wch: 15 }, // NBR
      { wch: 10 }, // Status
      { wch: 20 }, // Switch Name
      { wch: 15 }, // Capacity
      { wch: 12 }, // Upgrade Type
      { wch: 30 }, // Description
      { wch: 25 }, // Email
      { wch: 15 }, // Phone
      { wch: 15 }, // Area
      { wch: 15 }, // Provider
      { wch: 20 }, // Pastel Name
    ];
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, "IPT Customers");

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `ipt_customers_${status || 'all'}_${timestamp}.xlsx`;

    // Set headers for download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Write and send file
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);

  } catch (error) {
    console.error("Export IPT customers error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Export Shared customers to Excel
 */
exports.exportSharedCustomers = async (req, res) => {
  try {
    const { status, nbr, search } = req.query;

    // Build where clause
    const where = {};
    if (status && status !== "all") {
      where.operationalStatus = status;
    }

    // Get customers with filters - query from sharedcustomerinfos and include sharedcustomers
    const sharedCustomerInfos = await db.sharedcustomerinfos.findAll({
      where: nbr ? {
        nbr: {
          [db.Sequelize.Op.iLike]: `%${nbr}%`
        }
      } : undefined,
      include: [
        {
          model: db.sharedcustomers,
          where: status && status !== "all" ? { operationalStatus: status } : undefined,
          required: status && status !== "all" ? true : false,
        },
        {
          model: db.client_dbs,
          required: false
        }
      ]
    });

    // Filter by search if provided
    let filteredSharedCustomers = sharedCustomerInfos;
    if (search) {
      filteredSharedCustomers = sharedCustomerInfos.filter(customer =>
        customer.customerName?.toLowerCase().includes(search.toLowerCase()) ||
        customer.sharedcustomer?.interface?.toLowerCase().includes(search.toLowerCase()) ||
        customer.cid?.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Prepare data for Excel
    const excelData = filteredSharedCustomers.map(customer => ({
      "Customer Name": customer.customerName || "",
      "Interface": customer.sharedcustomer?.interface || "",
      "CID": customer.cid || "",
      "NBR": customer.nbr || "",
      "Status": customer.sharedcustomer?.operationalStatus || "",
      "Switch Name": customer.sharedcustomer?.switchName || "",
      "Capacity (Mbps)": customer.sharedcustomer?.capacity || "",
      "Upgrade Type": customer.upgrade_type === "temporary" ? "Temporary" : "Permanent",
      "Description": customer.sharedcustomer?.description || "",
      "Email": customer.client_db?.email_address || "",
      "Phone": customer.client_db?.phone_number || "",
      "Area": customer.client_db?.area || "",
      "Provider": customer.client_db?.provider || "",
      "Pastel Name": customer.client_db?.customer_name_pastel || "",
    }));

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    // Auto-size columns
    const colWidths = [
      { wch: 20 }, // Customer Name
      { wch: 15 }, // Interface
      { wch: 15 }, // CID
      { wch: 15 }, // NBR
      { wch: 10 }, // Status
      { wch: 20 }, // Switch Name
      { wch: 15 }, // Capacity
      { wch: 12 }, // Upgrade Type
      { wch: 30 }, // Description
      { wch: 25 }, // Email
      { wch: 15 }, // Phone
      { wch: 15 }, // Area
      { wch: 15 }, // Provider
      { wch: 20 }, // Pastel Name
    ];
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, "Shared Customers");

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `shared_customers_${status || 'all'}_${timestamp}.xlsx`;

    // Set headers for download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Write and send file
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);

  } catch (error) {
    console.error("Export Shared customers error:", error);
    res.status(500).json({ error: error.message });
  }
};
