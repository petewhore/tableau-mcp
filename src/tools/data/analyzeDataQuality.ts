import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const analyzeDataQualityTool = new Tool({
  name: 'analyze-data-quality',
  description: `
Analyze data quality for a Tableau data source using advanced analytics to identify issues, patterns, and recommendations.

**Parameters:**
- \`datasourceId\`: ID of the data source to analyze (required)
- \`sampleSize\`: Number of records to analyze (optional, default: 10000)
- \`includeProfile\`: Include detailed data profiling (optional, default: true)
- \`checkNulls\`: Analyze null value patterns (optional, default: true)
- \`checkDuplicates\`: Identify duplicate records (optional, default: true)
- \`checkOutliers\`: Detect statistical outliers (optional, default: true)

**Analysis Components:**
- **Completeness**: Missing values, null patterns, field coverage
- **Accuracy**: Data type consistency, format validation
- **Consistency**: Value standardization, reference integrity
- **Uniqueness**: Duplicate detection, key constraint validation
- **Validity**: Range checks, pattern matching, business rules
- **Statistical Profile**: Distributions, outliers, anomalies

**Data Quality Metrics:**
- **Quality Score**: Overall data quality rating (0-100)
- **Field Coverage**: Percentage of fields with complete data
- **Null Rate**: Percentage of missing values across dataset
- **Duplicate Rate**: Percentage of duplicate records
- **Outlier Rate**: Percentage of statistical outliers

**Quality Checks:**
- **Missing Data**: Identify patterns in missing values
- **Data Types**: Verify expected data types and formats
- **Value Ranges**: Check for values outside expected ranges
- **Referential Integrity**: Validate relationships between fields
- **Business Rules**: Apply domain-specific validation rules

**Example Usage:**
- Basic analysis: \`{ "datasourceId": "ds-123" }\`
- Detailed profiling: \`{ "datasourceId": "ds-123", "sampleSize": 50000, "includeProfile": true }\`
- Focus on duplicates: \`{ "datasourceId": "ds-123", "checkDuplicates": true, "checkNulls": false }\`
- Quick assessment: \`{ "datasourceId": "ds-123", "sampleSize": 1000, "includeProfile": false }\`

**Use Cases:**
- **Data Governance**: Regular quality monitoring and reporting
- **ETL Validation**: Verify data pipeline output quality
- **Analytics Preparation**: Ensure data readiness for analysis
- **Issue Detection**: Identify data problems before they impact users
- **Compliance**: Document data quality for regulatory requirements
`,
  paramsSchema: {
    datasourceId: z.string().min(1, 'Data source ID is required'),
    sampleSize: z.number().min(100).max(100000).optional(),
    includeProfile: z.boolean().optional(),
    checkNulls: z.boolean().optional(),
    checkDuplicates: z.boolean().optional(),
    checkOutliers: z.boolean().optional(),
  },
  annotations: {
    title: 'Analyze Data Quality',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ 
    datasourceId, 
    sampleSize, 
    includeProfile, 
    checkNulls, 
    checkDuplicates, 
    checkOutliers 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await analyzeDataQualityTool.logAndExecute({
      requestId,
      args: { datasourceId, sampleSize, includeProfile, checkNulls, checkDuplicates, checkOutliers },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Verify data source exists
          let datasource;
          try {
            datasource = await restApi.datasourcesMethods.getDatasource(restApi.siteId, datasourceId);
          } catch (error) {
            return new Err(`Data source with ID '${datasourceId}' not found`);
          }
          
          // Set analysis parameters
          const actualSampleSize = sampleSize || 10000;
          const doProfile = includeProfile ?? true;
          const doNullCheck = checkNulls ?? true;
          const doDuplicateCheck = checkDuplicates ?? true;
          const doOutlierCheck = checkOutliers ?? true;
          
          // Perform comprehensive data quality analysis using VizQL Data Service
          const qualityAnalysis = await restApi.vizqlDataServiceApi.analyzeDataQuality(restApi.siteId, {
            datasourceId,
            sampleSize: actualSampleSize,
            includeProfile: doProfile,
            checkNulls: doNullCheck,
            checkDuplicates: doDuplicateCheck,
            checkOutliers: doOutlierCheck,
          });
          
          // Calculate overall quality score
          const calculateQualityScore = (analysis: any) => {
            let score = 100;
            
            // Deduct for high null rates
            if (analysis.nullRate > 0.1) score -= (analysis.nullRate * 30);
            
            // Deduct for duplicates
            if (analysis.duplicateRate > 0.05) score -= (analysis.duplicateRate * 20);
            
            // Deduct for outliers
            if (analysis.outlierRate > 0.1) score -= (analysis.outlierRate * 15);
            
            // Deduct for data type issues
            if (analysis.typeInconsistencies > 0) score -= Math.min(analysis.typeInconsistencies * 5, 25);
            
            return Math.max(0, Math.round(score));
          };
          
          const qualityScore = calculateQualityScore(qualityAnalysis);
          
          // Categorize quality level
          const qualityLevel = (() => {
            if (qualityScore >= 90) return 'Excellent';
            if (qualityScore >= 80) return 'Good';
            if (qualityScore >= 70) return 'Fair';
            if (qualityScore >= 60) return 'Poor';
            return 'Critical';
          })();
          
          // Generate recommendations based on findings
          const generateRecommendations = (analysis: any) => {
            const recommendations: string[] = [];
            
            if (analysis.nullRate > 0.1) {
              recommendations.push('Address high null value rate - implement data validation at source');
            }
            
            if (analysis.duplicateRate > 0.05) {
              recommendations.push('Remove duplicate records - implement deduplication process');
            }
            
            if (analysis.outlierRate > 0.1) {
              recommendations.push('Investigate outliers - may indicate data entry errors or legitimate edge cases');
            }
            
            if (analysis.typeInconsistencies > 0) {
              recommendations.push('Fix data type inconsistencies - standardize data formats');
            }
            
            if (analysis.fieldCoverage < 0.8) {
              recommendations.push('Improve field coverage - ensure critical fields have complete data');
            }
            
            if (recommendations.length === 0) {
              recommendations.push('Data quality is good - maintain current data governance processes');
            }
            
            return recommendations;
          };
          
          const recommendations = generateRecommendations(qualityAnalysis);
          
          // Identify critical issues requiring immediate attention
          const criticalIssues = [];
          if (qualityAnalysis.nullRate > 0.25) criticalIssues.push('Extremely high null rate');
          if (qualityAnalysis.duplicateRate > 0.15) criticalIssues.push('High duplicate rate');
          if (qualityAnalysis.typeInconsistencies > 10) criticalIssues.push('Many data type issues');
          if (qualityAnalysis.fieldCoverage < 0.5) criticalIssues.push('Low field coverage');
          
          return new Ok({
            success: true,
            datasource: {
              id: datasource.id,
              name: datasource.name,
              type: datasource.type,
              projectName: datasource.project?.name,
              hasExtracts: datasource.hasExtracts,
            },
            qualityAnalysis: {
              qualityScore,
              qualityLevel,
              overallRating: qualityLevel,
              sampleSize: qualityAnalysis.recordsAnalyzed,
              totalRecords: qualityAnalysis.totalRecords,
              analysisDate: new Date().toISOString(),
            },
            metrics: {
              nullRate: Math.round(qualityAnalysis.nullRate * 1000) / 10, // Percentage with 1 decimal
              duplicateRate: Math.round(qualityAnalysis.duplicateRate * 1000) / 10,
              outlierRate: Math.round(qualityAnalysis.outlierRate * 1000) / 10,
              fieldCoverage: Math.round(qualityAnalysis.fieldCoverage * 1000) / 10,
              typeInconsistencies: qualityAnalysis.typeInconsistencies,
              uniqueValues: qualityAnalysis.uniqueValues,
            },
            fieldAnalysis: qualityAnalysis.fieldAnalysis || [],
            issues: {
              critical: criticalIssues,
              missing: qualityAnalysis.missingValues || [],
              duplicates: qualityAnalysis.duplicatePatterns || [],
              outliers: qualityAnalysis.outliers || [],
              typeIssues: qualityAnalysis.typeIssues || [],
            },
            recommendations,
            summary: {
              overallQuality: qualityLevel,
              score: qualityScore,
              recordsAnalyzed: qualityAnalysis.recordsAnalyzed,
              fieldsAnalyzed: qualityAnalysis.fieldsAnalyzed,
              issuesFound: criticalIssues.length,
              recommendationsCount: recommendations.length,
            },
            message: `Data quality analysis complete for '${datasource.name}' - Overall quality: ${qualityLevel} (${qualityScore}/100)`,
            warnings: {
              ...(criticalIssues.length > 0 ? 
                { criticalIssues: `${criticalIssues.length} critical data quality issues found requiring immediate attention` } : {}),
              ...(qualityScore < 70 ? 
                { lowQuality: 'Data quality is below acceptable standards - implement data governance improvements' } : {}),
              ...(qualityAnalysis.recordsAnalyzed < actualSampleSize ? 
                { limitedSample: 'Analysis based on limited sample size - results may not represent full dataset' } : {}),
            },
            actionableRecommendations: {
              ...(qualityScore < 80 ? 
                { improvement: 'Implement data quality improvement processes based on identified issues' } : {}),
              monitoring: 'Set up regular data quality monitoring to catch issues early',
              governance: 'Establish data quality standards and validation rules',
              automation: 'Consider automated data quality checks in ETL processes',
              documentation: 'Document data quality findings and improvement actions for compliance',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to analyze data quality: ${error}`);
        }
      },
    });
  },
});