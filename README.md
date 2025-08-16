# 🍷 Wine Data Migration

This folder contains everything needed to extract wine data from your legacy SQL Server system and prepare it for migration to the new Postgres-based winehaus-api system.

## 📁 File Structure

```
migration/
├── README.md                           # This overview file
├── MIGRATION_GUIDE.md                  # Detailed migration process
├── database.json.example               # Database configuration template
├── extract-legacy-data.js              # Main data extraction script
├── test-connection.js                  # Database connection test script
├── seed-legacy-data.ts                 # Data seeder for Postgres
├── run-seeder.ts                       # Seeder runner script
└── migrate-legacy-wine-data.sql        # Legacy SQL script (not needed)
```

## 🚀 Quick Start

### 1. **Setup**
```bash
# Install dependencies
pnpm install

# Configure database connection
cp migration/database.json.example migration/database.json
# Edit migration/database.json with your SQL Server details
```

### 2. **Test Connection**
```bash
# Test your database connection
pnpm run test:connection
```

### 3. **Extract Data**
```bash
# Extract all wine data
pnpm run extract:legacy
```

### 4. **Seed Data into New System**
- Check extracted data in `extracted-data/` folder
- Run the seeder to load data into your Postgres database:
  ```bash
  pnpm run seed:legacy
  ```
- Verify the data in your new system

## 🔧 Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `extract-legacy-data.js` | Extract wine data from SQL Server | `pnpm run extract:legacy` |
| `test-connection.js` | Test database connection | `pnpm run test:connection` |
| `seed-legacy-data.ts` | Seed extracted data into Postgres | `pnpm run seed:legacy` |

## 📊 Data Structure

The migration covers these wine-related entities:

- **Geographic**: Countries → Regions → Villages/AVAs
- **Production**: Producers, Brands, Vineyards
- **Wine Characteristics**: Varietals, Styles, Colors
- **Wine Items**: Complete wine records with relationships

## 🎯 Migration Approaches

1. **Automated**: Use the extraction script + generated import script
2. **Manual**: Extract data manually and use the SQL migration script
3. **Hybrid**: Combine automated extraction with manual review

## 📚 Documentation

- **[MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)** - Complete migration process and troubleshooting
- **[extract-legacy-data.js](./extract-legacy-data.js)** - Data extraction script documentation

## 🚨 Important Notes

- **Backup your data** before running any migration
- **Test in development** environment first
- **Review extracted data** for completeness and accuracy
- **Verify relationships** are preserved correctly

## 🆘 Support

If you encounter issues:

1. Check the console output for error messages
2. Verify database connection settings
3. Ensure all dependencies are installed
4. Review the troubleshooting sections in MIGRATION_GUIDE.md
5. Test your connection first with `pnpm run test:connection`

---

**Next**: Read [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) for detailed migration instructions.
