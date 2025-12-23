# Liquid Telecom Customer Circuit Monitoring System

## 🌟 What This System Actually Does

**In simple terms:** This is a practical tool for telecom network operations teams to monitor customer internet circuits and manage customer data. It automatically checks your network switches, tracks which customer connections are working or down, and helps you export customer information for billing and reporting.

**Real function:** A database-driven application that uses SSH to connect to network switches, runs "show interfaces descriptions" commands, parses the output to extract customer information, and stores this data for NOC operators to monitor and report on.

---

## 📋 What It Actually Does

### 🔍 **Customer Circuit Monitoring**
- **SSH Monitoring**: Connects to network switches via SSH and runs "show interfaces descriptions" commands
- **Data Parsing**: Extracts customer information from command outputs (interface names, status, descriptions)
- **Status Tracking**: Monitors whether customer circuits are "up" or "down"
- **Database Storage**: Stores customer data in MySQL database tables

### 📊 **Basic Reporting & Data Management**
- **Excel Export**: Exports customer data to Excel files with simple filtering (by status, NBR name, search)
- **Customer Search**: Basic search functionality for finding specific customers
- **Data Organization**: Separates customers into DIA, IPT, and Shared categories
- **Status History**: Tracks when circuits change from up to down (basic change detection)

### 🔧 **Automated Data Updates**
- **Hourly Updates**: Cron jobs run every hour to refresh customer data from switches
- **Stale Data Cleanup**: Daily cleanup removes customer records that are no longer found on switches
- **Status Change Alerts**: Sends notifications when circuits go down
- **Scheduled Maintenance**: Automated tasks keep data current

### 💻 **User Interfaces**
- **Web Dashboard**: React-based interface to view customer data and export reports
- **Mobile App** (In Development): Basic mobile interface for viewing customer status
- **API Endpoints**: REST API for accessing customer data programmatically

---

## 🏗️ How It Actually Works

### Current System Components

#### 🖥️ **Backend Server** (Node.js/Express)
The core application that:
- Uses SSH2 library to connect to Juniper network switches
- Runs CLI commands like "show interfaces descriptions" on switches
- Parses text output to extract customer interface information
- Stores data in MySQL database using Sequelize ORM
- Runs cron jobs (every hour) to update customer data
- Provides REST API endpoints for the web interface
- Sends Socket.IO notifications for status changes

#### 🌐 **Web Dashboard** (React/TypeScript)
A web interface that:
- Displays customer data in tables (DIA, IPT, Shared customers)
- Allows filtering by status (up/down) and search
- Exports data to Excel files
- Shows basic status information
- Has user authentication (basic)

#### 📱 **Mobile App** (React Native - Partially Built)
Basic mobile interface:
- View customer lists
- Basic navigation structure
- Not fully functional yet

#### 🧠 **ML Service** (Python/FastAPI - Partially Built)
Experimental AI features:
- Basic anomaly detection using statistical methods
- 95th percentile traffic forecasting
- Not integrated into main system yet

### Network Equipment Monitored

#### **Core Network Devices**
- **BNG Switches**: Broadband Network Gateways (LTZ-BNG02-TIG-DAR, LTZ-BNG02-RAH-DAR)
- **PE Routers**: Provider Edge routers (LTZ-PE1-RAH, LTZ-PE1-TIG)
- **P Routers**: Provider routers (LTZ-P1-DAR)

#### **Access Layer Switches**
- **ACC Switches**: Access Concentrator switches for Shared customer circuits
  - LTZ-ACC2-RAH (handles ge-0/0/63 and ge-0/0/79 interfaces)
  - LTZ-ACC3-RAH (handles ge-0/0/36 interface)

#### **Customer Circuit Types**
- **DIA (Direct Internet Access)**: Dedicated internet connections
- **IPT (Internet Protocol Television)**: TV broadcasting circuits
- **Shared**: Shared bandwidth circuits for multiple customers

---

## 🚀 How It Actually Works (Day-to-Day Operations)

### **Automated Background Tasks**
- **Every Hour**: Cron jobs connect to switches and run "show interfaces descriptions"
- **Parse Output**: Extracts interface names, status (up/down), and customer descriptions
- **Update Database**: Inserts/updates customer records in database tables
- **Status Change Detection**: Compares old vs new status and sends notifications if circuits go down
- **Daily at 2 AM**: Removes customer records that are no longer found on switches

### **Manual Operations**
1. **NOC Operators** open the web dashboard
2. **View Customer Tables**: See lists of DIA, IPT, or Shared customers
3. **Check Status**: See which circuits are up (green) or down (red)
4. **Export Data**: Click "Export Excel" to get customer lists for billing or reports
5. **Search/Filter**: Use basic filters to find specific customers by name, CID, or interface

### **Current Limitations**
- **Not Real-time**: Updates only happen hourly (not continuous monitoring)
- **Basic Status Only**: Only tracks up/down, not detailed diagnostics
- **Manual Process**: Requires NOC operators to check the dashboard regularly
- **No Proactive Alerts**: Only detects status changes during scheduled updates

---

## 🔧 Technical Setup

### Prerequisites
- **Network Access**: SSH access to all network switches and routers
- **Database**: MySQL database for storing customer and network data
- **Server**: Linux/Windows server with Node.js installed

### Quick Installation

```bash
# 1. Install backend dependencies
cd backend
npm install

# 2. Configure database connection (.env file)
DB_HOST=your_database_server
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=automation_db

# 3. Configure network device access
SSH_USERNAME=your_network_username
SSH_PASSWORD=your_network_password

# 4. Start the backend server
npm run dev

# 5. Start the web dashboard
cd ../nexus-layout-flex
npm install
npm run dev
```

### Network Device Configuration
The system connects to these devices using SSH:
- **Username**: godwin.makyao (configurable)
- **Authentication**: Password-based SSH
- **Commands**: Automated show commands to gather interface and customer data

---

## 📈 Realistic Future Plans

### **Phase 1: Mobile App Completion** (When Resources Available)
- **Basic Customer Viewing**: Complete the mobile interface for viewing customer status
- **Push Notifications**: Alerts when customer circuits go down
- **Offline Data**: Cache customer data for offline viewing
- **Field Tech Tools**: Basic circuit information access for technicians

### **Phase 2: ML Service Integration** (If Budget Allows)
- **Basic Anomaly Detection**: Flag unusual traffic patterns (already partially built)
- **Traffic Forecasting**: Predict bandwidth needs (already partially built)
- **Automated Reports**: Generate capacity reports automatically

### **Phase 3: System Improvements** (Ongoing)
- **Better Error Handling**: More robust SSH connection handling
- **Performance Optimization**: Faster data updates and queries
- **Additional Filters**: More export options and search capabilities
- **User Management**: Better authentication and access controls

---

## 👥 Who Uses This System

### **Network Operations Team**
- Monitor circuit status in real-time
- Generate reports for management
- Troubleshoot customer issues quickly
- Plan network capacity upgrades

### **Field Technicians**
- Access customer information on mobile devices
- Test circuits before/after installations
- Report issues directly from field

### **Management**
- Overview dashboards for network health
- Capacity planning reports
- Customer satisfaction metrics
- Business intelligence insights

### **Billing Department**
- Export customer data for invoicing
- Track service level agreements
- Monitor revenue-generating circuits

---

## 🛡️ Security & Reliability

### **Network Security**
- SSH encryption for all device connections
- Secure credential storage
- Access logging and monitoring
- Network segmentation compliance

### **Data Protection**
- Encrypted database connections
- Regular data backups
- Access control and permissions
- Audit trails for all changes

### **System Reliability**
- Automated monitoring of the monitoring system
- Redundant data sources
- Graceful error handling
- 99.9% uptime design

---

## 📞 Support & Maintenance

### **Daily Operations**
- System runs autonomously 24/7
- Automated alerts for issues
- Self-healing capabilities
- Regular data validation

### **Weekly Maintenance**
- Review system health reports
- Update network device credentials
- Backup verification
- Performance optimization

### **Monthly Reviews**
- Capacity planning reports
- Customer growth analysis
- System performance metrics
- Future enhancement planning

---

## 🎯 Realistic Benefits

### **What This System Actually Provides**
- ✅ **Automated Data Collection**: No more manual SSH connections to switches for customer lists
- ✅ **Centralized Customer Database**: Single source of truth for customer circuit information
- ✅ **Basic Status Monitoring**: Hourly checks prevent missing down circuits for too long
- ✅ **Excel Reporting**: Faster generation of customer reports for billing and management
- ✅ **Data Cleanup**: Prevents database from filling with old, inactive customer records

### **Current Limitations to Acknowledge**
- ⚠️ **Not Real-time**: Status updates only happen hourly, not instantly
- ⚠️ **Basic Monitoring Only**: Only tracks interface up/down status, not detailed diagnostics
- ⚠️ **Manual Intervention Required**: NOC operators still need to check dashboard and respond to alerts
- ⚠️ **No Predictive Capabilities**: Doesn't prevent issues, only detects them after they happen

---

## 📚 Technical Documentation

For developers and technical staff:

### **API Documentation**
- RESTful API endpoints for all system functions
- Real-time WebSocket events for live updates
- Integration guides for external systems

### **Database Schema**
- Customer tables (DIA, IPT, Shared)
- Network device inventory
- Status change history
- Performance metrics

### **Network Commands**
- Automated CLI commands for device monitoring
- Configuration backup procedures
- Troubleshooting command references

---

*This is a practical tool that helps telecom NOC operators do their job more efficiently. It automates the tedious task of manually checking switches for customer status and provides basic reporting capabilities. It's not an advanced AI system or self-healing network - it's a database application that collects and organizes customer circuit data from your network switches.*

**A working solution for Liquid Telecom Tanzania's operational needs** 🔧
