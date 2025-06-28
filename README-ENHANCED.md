# Tableau MCP Enhanced

An enhanced version of the official Tableau MCP server with **81 comprehensive tools** providing complete Tableau Cloud/Server API coverage with enterprise-grade features.

## 🚀 What's Enhanced

### **Massive Tool Expansion**
- **Original**: 4 basic tools (list-datasources, list-fields, query-datasource, read-metadata)
- **Enhanced**: 81 comprehensive tools covering all major Tableau APIs

### **Enterprise-Grade Features**
- **Advanced Error Handling**: Functional error handling with `ts-results-es` and graceful degradation
- **Impact Analysis**: Pre-operation risk assessment and cascading impact analysis
- **Business Intelligence**: Comprehensive analytics, recommendations, and insights
- **Operational Safety**: Detailed warnings, compliance reporting, and audit trails

### **Complete API Coverage**
- ✅ **User Management** (5 tools): Create, list, update, delete users
- ✅ **Workbook Management** (5 tools): Full CRUD operations with publishing
- ✅ **Data Source Management** (5 tools): Enhanced with certification and encryption
- ✅ **Project Management** (2 tools): Hierarchical project operations
- ✅ **Permission Management** (5 tools): Advanced permission analytics and bulk operations
- ✅ **Group Management** (5 tools): Complete group lifecycle management
- ✅ **View Management** (3 tools): View operations and data extraction
- ✅ **Schedule Management** (4 tools): Extract refresh and task scheduling
- ✅ **Subscription Management** (3 tools): Alert and delivery management
- ✅ **Webhook Management** (3 tools): Real-time integration support
- ✅ **Data Alerts** (2 tools): Intelligent monitoring and notifications
- ✅ **Analytics & Monitoring** (1 tool): Usage statistics and performance metrics
- ✅ **Content Export** (1 tool): Multi-format workbook export
- ✅ **Bulk Operations** (1 tool): Mass permission updates
- ✅ **And much more...**

## 📊 Comparison with Original

| Feature | Original | Enhanced |
|---------|----------|----------|
| **Total Tools** | 4 | 81 |
| **API Coverage** | ~5% | ~75% |
| **Error Handling** | Basic | Enterprise-grade |
| **Analytics** | None | Comprehensive |
| **Impact Analysis** | None | Advanced |
| **Business Intelligence** | None | Full suite |
| **Bundle Size** | 179KB | 668KB |

## 🏗️ Architecture

Built on the same solid foundation as the original Tableau MCP:

- **TypeScript**: Full type safety and modern language features
- **MCP SDK**: Official Model Context Protocol integration
- **Zod Validation**: Comprehensive input validation
- **ts-results-es**: Functional error handling
- **Same Build System**: esbuild, vitest, eslint

## 🛡️ Enterprise Features

### **Advanced Error Handling**
```typescript
// Functional error handling with type safety
return new Err(`Project with ID '${projectId}' not found`);
return new Ok({ success: true, data: result, analysis: {...} });

// Graceful degradation
try {
  const workbooks = await getWorkbooks();
} catch (error) {
  // Continue operation even if some data gathering fails
}
```

### **Impact Analysis**
```typescript
// Quantified risk assessment
const deletionRisk = (() => {
  let risk = 0;
  if (totalContent > 20) risk += 4;
  if (childProjectCount > 0) risk += 3;
  if (totalViews > 10) risk += 3;
  
  if (risk >= 8) return 'Critical';
  if (risk >= 6) return 'High';
  return 'Medium';
})();
```

### **Business Intelligence**
```typescript
return new Ok({
  success: true,
  project: deletionContext,
  impact: { deletionRisk, contentDeleted: {...} },
  warnings: { permanentDeletion: '...' },
  recommendations: { urgentCommunication: '...' },
  summary: { projectName, contentDeleted: totalContent }
});
```

## 🚀 Installation

```bash
# Clone the enhanced repository
git clone https://github.com/your-fork/tableau-mcp-enhanced.git
cd tableau-mcp-enhanced

# Install dependencies
npm install

# Build the enhanced server
npm run build

# Test with MCP Inspector
npm run build:inspect
```

## 📖 Usage

The enhanced server maintains full compatibility with the original while adding 77 additional tools:

```javascript
// Original tools still work exactly the same
{
  "name": "list-datasources",
  "filter": "projectName:eq:Finance"
}

// Plus 77 new enterprise tools
{
  "name": "delete-project",
  "projectId": "proj-123"
}
// Returns comprehensive impact analysis, warnings, and recommendations
```

## 🎯 Enterprise Use Cases

### **Operational Safety**
- **Pre-flight Checks**: Analyze impact before destructive operations
- **Risk Assessment**: Quantified risk scoring for compliance
- **Cascading Analysis**: Understand downstream effects

### **Business Intelligence**
- **Usage Analytics**: Comprehensive usage statistics and trends
- **Performance Monitoring**: Alert systems and health monitoring
- **Compliance Reporting**: Audit trails and governance support

### **Process Automation**
- **Webhook Integration**: Real-time event notifications
- **Bulk Operations**: Mass permission updates and content management
- **Workflow Orchestration**: Schedule management and task automation

## 🔧 Configuration

Uses the same configuration as the original:

```json
{
  "mcpServers": {
    "tableau": {
      "command": "node",
      "args": ["./build/index.js"],
      "env": {
        "TABLEAU_SERVER_URL": "https://your-server.tableau.com",
        "TABLEAU_SITE_ID": "your-site",
        "TABLEAU_USERNAME": "your-username",
        "TABLEAU_PASSWORD": "your-password"
      }
    }
  }
}
```

## 📈 Performance

- **Optimized Bundle**: Efficient esbuild compilation
- **Type Safety**: Full TypeScript with zero runtime overhead
- **Error Efficiency**: Functional error handling reduces exception overhead
- **Caching**: Smart API response caching where appropriate

## 🛠️ Development

Built with the same professional standards:

```bash
# Development
npm run build:watch
npm run test
npm run coverage
npm run lint

# Testing
npm run build:inspect
```

## 🤝 Contributing

This enhanced version maintains compatibility with the original Tableau MCP contribution guidelines. All enhancements follow the same architectural patterns and coding standards.

## 📋 Remaining APIs

While we've implemented 81 tools covering ~75% of the Tableau API, there are still some areas for future enhancement:

- **Custom Views** (8 tools pending)
- **Flow/Prep Integration** (9 tools pending)  
- **Database Connections** (6 tools pending)
- **Connected Apps** (6 tools pending)
- **Additional Analytics Extensions**

See the comprehensive TODO list for detailed planning.

## 📜 License

Apache-2.0 (same as original Tableau MCP)

## 🙏 Acknowledgments

Built on the excellent foundation provided by the official Tableau MCP team. This enhanced version extends their professional architecture with enterprise features while maintaining full compatibility.

---

**Enhanced with ❤️ for the Tableau community**