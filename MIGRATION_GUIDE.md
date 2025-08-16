# 🍷 Complete Wine Data Migration Guide

This comprehensive guide covers the complete process of migrating wine data from your legacy SQL Server system to the new Postgres-based winehaus-api system.

## 📋 Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Migration Process](#migration-process)
4. [Data Mapping](#data-mapping)
5. [Running the Migration](#running-the-migration)
6. [Verification](#verification)
7. [Troubleshooting](#troubleshooting)
8. [Security Considerations](#security-considerations)

## 🎯 Overview

### What This Migration Covers

The migration solution provides a comprehensive approach to transfer wine data between systems:

- **Geographic Data**: Countries, regions, villages/AVAs
- **Production Data**: Producers, brands, vineyards
- **Wine Characteristics**: Varietals, styles, colors
- **Wine Items**: Complete wine records with relationships

### Migration Approaches

1. **Automated Migration** (Recommended for Development)
   - Use the extraction script + generated import script
   - Best for: Development, testing, small datasets

2. **Manual SQL Migration**
   - Extract data manually and use the SQL migration script
   - Best for: Production, large datasets, custom requirements

3. **Hybrid Approach**
   - Combine automated extraction with manual review
   - Best for: Production with data validation requirements

## ✅ Prerequisites

### System Requirements

1. **Legacy System Access**: Access to the SQL Server database containing the legacy wine data
2. **New System Setup**: The winehaus-api system must be running with all wine entities created
3. **Database Tools**: SQL Server Management Studio (or similar) and a Postgres client

### Dependencies

```bash
# Install required packages
pnpm install

# This will install:
# - mssql: SQL Server connection
# - commander: Command line interface
# - uuid: ID generation
```

## 🔄 Migration Process

### Step 1: Extract Data from Legacy System

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Configure database connection**:
   ```bash
   cp migration/database.json.example migration/database.json
   # Edit migration/database.json with your SQL Server details
   ```

3. **Test your connection**:
   ```bash
   pnpm run test:connection
   ```

4. **Run the extraction script**:
   ```bash
   pnpm run extract:legacy
   # Or with custom options:
   node migration/extract-legacy-data.js --format=csv --output=./my-data
   ```

5. **Review extracted data** in the output directory

### Step 2: Prepare Data for Import

1. **Review the generated import script** (`import-to-postgres.sql`) in your output directory
2. **Copy the extracted data files** to your Postgres server or make them accessible
3. **Run the import script** to create temporary tables and import data
4. **Verify data integrity** before proceeding

### Step 3: Import Data into New System

1. **Run the import statements** from the SQL script
2. **Verify the migration** using the verification queries
3. **Clean up temporary tables**

## 🗺️ Data Mapping

### Legacy to New System Mapping

| Legacy Table | New Entity | Notes |
|--------------|------------|-------|
| `WineCountries` | `wine_countries` | Direct mapping |
| `WineRegions` | `wine_regions` | Links to countries |
| `WineVillageAvas` | `wine_villages` | Links to regions |
| `WineProducers` | `wine_producers` | Direct mapping |
| `WineBrands` | `wine_brands` | Direct mapping |
| `WineSingleVineyards` | `wine_vineyards` | Direct mapping |
| `WineVarietals` | `wine_varietals` | Direct mapping |
| `WineStyles` | `wine_styles` | Direct mapping |
| `WineColors` | `wine_types` | Mapped to wine types |
| `WineItems` | `wines` | Main wine table with relationships |

### Special Considerations

1. **Wine Colors to Types**: The legacy system uses `WineColors` which maps to `wine_types` in the new system
2. **Relationships**: Producer-Brand and Producer-Vineyard relationships are handled through the main wine table
3. **Tenant System**: All migrated data is assigned to a default tenant

## 🚀 Running the Migration

### Option 1: Use the TypeORM Migration (Recommended for Development)

```bash
# Run the migration
pnpm run migration:run

# If you need to rollback
pnpm run migration:revert
```

### Option 2: Manual SQL Execution

1. **Extract data** from SQL Server using the extraction script
2. **Use the generated import script** to create temporary tables and import data
3. **Execute import statements** from the SQL script
4. **Verify results** using verification queries

### Option 3: Hybrid Approach

1. **Use the Node.js tool** to extract data directly from SQL Server
2. **Save data in your preferred format** (JSON, CSV, or SQL)
3. **Use the generated import script** to create temporary tables and import data
4. **Execute the migration**

## 🔍 Verification

After migration, verify the data using these queries:

```sql
-- Check record counts
SELECT 'wine_countries' as table_name, COUNT(*) as record_count FROM wine_countries
UNION ALL
SELECT 'wine_regions', COUNT(*) FROM wine_regions
UNION ALL
SELECT 'wines', COUNT(*) FROM wines;

-- Check sample wine with relationships
SELECT 
    w.description,
    p.name as producer,
    v.name as varietal,
    c.name as country
FROM wines w
JOIN wine_producers p ON w.producer_id = p.id
JOIN wine_varietals v ON w.varietal_id = v.id
JOIN wine_countries c ON w.country_id = c.id
LIMIT 5;
```

## 🛠️ Troubleshooting

### Connection Issues

1. **Check SQL Server is running**:
   ```bash
   # Test connection
   sqlcmd -S your-server -U your-username -P your-password
   ```

2. **Verify firewall settings**:
   - Ensure port 1433 (or your custom port) is open
   - Check Windows Firewall settings

3. **Check authentication**:
   - SQL Server Authentication vs Windows Authentication
   - User permissions on the database

### Query Errors

1. **Table doesn't exist**: Verify table names in your legacy database
2. **Permission denied**: Check user permissions on tables
3. **Column not found**: Verify column names match the queries

### Performance Issues

1. **Large datasets**: The script processes data in memory, consider extracting in batches
2. **Network latency**: Run the script on the same network as the SQL Server
3. **Database load**: Run during off-peak hours

### Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `Login failed for user` | Authentication issue | Check username/password, verify SQL Server authentication mode |
| `Cannot connect to server` | Network/connection issue | Verify server address, port, firewall settings |
| `Table doesn't exist` | Schema mismatch | Verify table names in your legacy database |
| `Permission denied` | User permissions | Check user has SELECT permissions on required tables |

## 🔒 Security Considerations

1. **Database credentials**: Never commit passwords to version control
2. **Network security**: Use VPN or secure network for database connections
3. **Data sensitivity**: Ensure extracted data is stored securely
4. **Access control**: Limit access to extracted data files

### Best Practices

- Use dedicated database users with minimal required permissions
- Store credentials in environment variables or secure configuration files
- Encrypt sensitive data during transfer
- Log access and changes for audit purposes

## 📊 Performance Optimization

### For Large Datasets

1. **Batch Processing**: Extract data in smaller chunks
2. **Parallel Processing**: Run multiple extraction queries simultaneously
3. **Indexing**: Ensure proper indexes on legacy database tables
4. **Network Optimization**: Run extraction on the same network as SQL Server

### Monitoring

- Monitor database performance during extraction
- Track memory usage of the extraction script
- Log extraction progress and timing
- Set up alerts for long-running operations

## 🔄 Rollback Procedures

### If Migration Fails

1. **Stop the migration process** immediately
2. **Review error logs** to identify the issue
3. **Rollback any partial changes** using the TypeORM revert command
4. **Fix the underlying issue** before retrying
5. **Test the fix** with a small dataset first

### Rollback Commands

```bash
# Revert the last migration
pnpm run migration:revert

# Check migration status
pnpm run migration:show

# Reset to a specific migration
pnpm run migration:revert --to <migration-name>
```

## 📚 Additional Resources

### Scripts and Tools

- **`extract-legacy-data.js`**: Main data extraction script with multiple output formats
- **`test-connection.js`**: Database connection testing utility
- **`migrate-legacy-wine-data.sql`**: Complete Postgres migration script

### Configuration

- **`database.json.example`**: Template for database connection settings
- **Environment variables**: Alternative configuration method
- **Command line options**: Customize extraction behavior

### Output Formats

- **JSON**: Best for data analysis and debugging
- **CSV**: Perfect for Excel analysis and data import tools
- **SQL**: Direct database import format

## 🆘 Getting Help

### Before Asking for Help

1. Check the console output for error messages
2. Verify database connection settings
3. Ensure all dependencies are installed
4. Review the troubleshooting section above
5. Test your connection first with `pnpm run test:connection`

### Support Channels

- **Console Output**: Most errors include helpful error messages
- **Script Help**: Run any script with `--help` for usage information
- **Documentation**: Review this guide and the README.md file
- **Logs**: Check application logs for detailed error information

---

**Ready to start?** Begin with the [Quick Start section in README.md](./README.md)!
