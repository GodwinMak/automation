module.exports = (sequelize, DataTypes) => {
    return User = sequelize.define('user', {
        id:{
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        username:{
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        email:{
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        password:{
            type: DataTypes.STRING,
            allowNull: false,
        },
        fullName: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        role: {
            type: DataTypes.ENUM('admin', 'operator', 'customer_relation'),
            allowNull: false,
            defaultValue: 'operator',
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        // Beem SMS format: country code without '+', e.g. 255712345678
        phoneNumber: {
            type: DataTypes.STRING,
            allowNull: true,
            validate: {
                is: /^255\d{9}$/,
            },
        },
        // Whether this user receives ISIS link up/down SMS alerts. Default
        // true for new users per the notification-preferences feature —
        // existing users are backfilled to true by
        // scripts/addSmsPreferenceColumns.js.
        canReceiveIsisSms: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        // Whether this user receives ISIS high-traffic (>85% utilisation)
        // SMS alerts. Split out from canReceiveIsisSms so the two alert
        // categories can be toggled independently.
        highTrafficSmsEnabled: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        // "all": receive ISIS link/high-traffic SMS for every link
        // network-wide (default). "watchlist": only for links this user has
        // added to their isis_watchlist (matched by point_to_point_ip).
        isisWatchScope: {
            type: DataTypes.ENUM("all", "watchlist"),
            allowNull: false,
            defaultValue: "all",
        },
        // Per-user grant for the cron process monitoring page — kept as a
        // standalone flag rather than folded into ROLE_PERMISSIONS
        // (middleware/auth.js) because that system is role-wide (every
        // admin/operator/customer_relation gets the same set); this needs
        // to be grantable to one specific person regardless of their role.
        canViewProcessMonitoring: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        // Timestamp of when the user last changed their password
        passwordChangedAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        lastLogin: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        createdBy: {
            type: DataTypes.UUID,
            allowNull: true,
        }
    })
}