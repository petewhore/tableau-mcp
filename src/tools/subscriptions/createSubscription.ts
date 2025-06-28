import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const createSubscriptionTool = new Tool({
  name: 'create-subscription',
  description: `
Create a new subscription for automated delivery of Tableau content via email. Subscriptions send views or workbooks on a scheduled basis.

**Parameters:**
- \`subject\`: Email subject line (required)
- \`userId\`: ID of user to receive the subscription (required)
- \`scheduleId\`: ID of schedule to determine delivery timing (required)
- \`contentType\`: Type of content - View or Workbook (required)
- \`contentId\`: ID of the specific content to subscribe to (required)
- \`message\`: Optional email message body
- \`attachImage\`: Include PNG image attachment (optional, default: true)
- \`attachPdf\`: Include PDF attachment (optional, default: false)
- \`pageOrientation\`: PDF orientation - Portrait or Landscape (optional)
- \`pageSizeOption\`: PDF page size (optional, default: Letter)

**Content Types:**
- \`View\`: Subscribe to a specific worksheet/dashboard view
- \`Workbook\`: Subscribe to an entire workbook (multiple views)

**Attachment Options:**
- **PNG Image**: High-quality image of the view/workbook
- **PDF**: Formatted PDF document with view/workbook content
- **Both**: Include both image and PDF attachments

**PDF Configuration:**
- **Orientation**: Portrait (tall) or Landscape (wide)
- **Page Sizes**: Letter, A4, A3, Legal, Tabloid, and more
- **Quality**: Optimized for email delivery

**Schedule Integration:**
- Uses existing schedules (Extract, Subscription, or Flow types)
- Subscription inherits schedule timing and frequency
- Multiple subscriptions can use the same schedule

**Example Usage:**
- Basic view subscription: \`{ "subject": "Daily Sales Dashboard", "userId": "user-123", "scheduleId": "daily-schedule", "contentType": "View", "contentId": "view-456" }\`
- Workbook with PDF: \`{ "subject": "Weekly Report", "userId": "user-789", "scheduleId": "weekly-schedule", "contentType": "Workbook", "contentId": "wb-012", "attachPdf": true, "pageOrientation": "Landscape" }\`
- Custom message: \`{ "subject": "Executive Summary", "userId": "user-345", "scheduleId": "monthly-schedule", "contentType": "View", "contentId": "view-678", "message": "Please review the attached monthly summary dashboard." }\`

**Best Practices:**
- Use descriptive subject lines that indicate content and frequency
- Test subscriptions with yourself before assigning to others
- Consider email size limits when including PDF attachments
- Use appropriate schedules that match business needs
- Document subscription purposes for governance
`,
  paramsSchema: {
    subject: z.string().min(1, 'Email subject is required'),
    userId: z.string().min(1, 'User ID is required'),
    scheduleId: z.string().min(1, 'Schedule ID is required'),
    contentType: z.enum(['View', 'Workbook']),
    contentId: z.string().min(1, 'Content ID is required'),
    message: z.string().optional(),
    attachImage: z.boolean().optional(),
    attachPdf: z.boolean().optional(),
    pageOrientation: z.enum(['Portrait', 'Landscape']).optional(),
    pageSizeOption: z.enum(['A3', 'A4', 'A5', 'B4', 'B5', 'Executive', 'Folio', 'Ledger', 'Legal', 'Letter', 'Note', 'Quarto', 'Tabloid']).optional(),
  },
  annotations: {
    title: 'Create Subscription',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    subject, 
    userId, 
    scheduleId, 
    contentType, 
    contentId, 
    message, 
    attachImage, 
    attachPdf, 
    pageOrientation, 
    pageSizeOption 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await createSubscriptionTool.logAndExecute({
      requestId,
      args: { subject, userId, scheduleId, contentType, contentId, message, attachImage, attachPdf, pageOrientation, pageSizeOption },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Verify user exists
          let user;
          try {
            const users = await restApi.usersMethods.listUsers(restApi.siteId, `id:eq:${userId}`);
            user = users.users[0];
            if (!user) {
              return new Err(`User with ID '${userId}' not found`);
            }
          } catch (error) {
            return new Err(`User with ID '${userId}' not found`);
          }
          
          // Verify schedule exists
          let schedule;
          try {
            schedule = await restApi.schedulesMethods.getSchedule(restApi.siteId, scheduleId);
          } catch (error) {
            return new Err(`Schedule with ID '${scheduleId}' not found`);
          }
          
          // Verify content exists and get details
          let contentName = 'Unknown';
          let contentOwner = 'Unknown';
          let projectName = 'Unknown';
          try {
            if (contentType === 'View') {
              const view = await restApi.viewsMethods.getView(restApi.siteId, contentId);
              contentName = view.name;
              contentOwner = view.owner.name;
              projectName = view.project.name;
            } else if (contentType === 'Workbook') {
              const workbook = await restApi.workbooksMethods.getWorkbook(restApi.siteId, contentId);
              contentName = workbook.name;
              contentOwner = workbook.owner?.name || 'Unknown';
              projectName = workbook.project?.name || 'Unknown';
            }
          } catch (error) {
            return new Err(`${contentType} with ID '${contentId}' not found`);
          }
          
          // Create the subscription
          const subscription = await restApi.viewsMethods.createSubscription(restApi.siteId, {
            subject,
            message,
            userId,
            scheduleId,
            contentType,
            contentId,
            attachImage: attachImage ?? true,
            attachPdf: attachPdf ?? false,
            pageOrientation,
            pageSizeOption,
          });
          
          // Analyze subscription configuration
          const hasAttachments = subscription.attachImage || subscription.attachPdf;
          const attachmentTypes = [
            subscription.attachImage ? 'PNG Image' : null,
            subscription.attachPdf ? 'PDF Document' : null,
          ].filter(Boolean);
          
          const deliveryFrequency = schedule.frequency;
          const isActive = !subscription.suspended;
          
          // Estimate email size and delivery characteristics
          const estimatedEmailSize = (() => {
            let size = 50; // Base email size in KB
            if (subscription.attachImage) size += 500; // PNG typically 500KB
            if (subscription.attachPdf) size += 1000; // PDF typically 1MB
            return size;
          })();
          
          const emailSizeCategory = (() => {
            if (estimatedEmailSize < 100) return 'Small';
            if (estimatedEmailSize < 1000) return 'Medium';
            return 'Large';
          })();
          
          return new Ok({
            success: true,
            subscription: {
              id: subscription.id,
              subject: subscription.subject,
              message: subscription.message,
              user: {
                id: subscription.userId,
                name: subscription.userName,
              },
              schedule: {
                id: subscription.schedule.id,
                name: subscription.schedule.name,
                frequency: subscription.schedule.frequency,
              },
              content: {
                id: subscription.content.id,
                name: subscription.content.name,
                type: subscription.content.type,
                owner: contentOwner,
                project: projectName,
              },
              attachments: {
                attachImage: subscription.attachImage,
                attachPdf: subscription.attachPdf,
                pageOrientation: subscription.pageOrientation,
                pageSizeOption: subscription.pageSizeOption,
              },
              suspended: subscription.suspended,
              lastSent: subscription.lastSent,
            },
            configuration: {
              deliveryFrequency,
              isActive,
              hasAttachments,
              attachmentTypes,
              estimatedEmailSize,
              emailSizeCategory,
              hasCustomMessage: !!message,
            },
            delivery: {
              nextDelivery: schedule.nextRunAt,
              frequency: deliveryFrequency,
              recipient: user.name,
              recipientEmail: user.email || 'Email not available',
              timezone: 'Server timezone', // Could be enhanced with actual timezone info
            },
            summary: {
              subscriptionCreated: true,
              contentType: subscription.content.type,
              contentName,
              recipientName: user.name,
              scheduleFrequency: deliveryFrequency,
              attachmentCount: attachmentTypes.length,
              willDeliverAutomatically: isActive,
            },
            message: `Successfully created ${deliveryFrequency.toLowerCase()} subscription for ${contentType.toLowerCase()} '${contentName}' to user '${user.name}'`,
            warnings: {
              ...(estimatedEmailSize > 2000 ? 
                { largeEmail: 'Subscription will generate large emails - consider recipient email limits' } : {}),
              ...(deliveryFrequency === 'Hourly' ? 
                { frequentDelivery: 'Hourly subscriptions may overwhelm recipients - ensure this frequency is necessary' } : {}),
              ...(contentType === 'Workbook' && !subscription.attachPdf ? 
                { workbookLimitation: 'Workbook subscriptions may be better suited for PDF format to include all views' } : {}),
            },
            recommendations: {
              testing: 'Test the subscription by temporarily subscribing yourself to verify content and formatting',
              ...(subscription.attachPdf ? 
                { pdfOptimization: 'Review PDF output to ensure proper formatting and readability' } : {}),
              ...(deliveryFrequency === 'Daily' ? 
                { timing: 'Ensure daily delivery schedule aligns with when recipients need the information' } : {}),
              monitoring: 'Monitor subscription delivery success and recipient feedback',
              documentation: 'Document subscription purpose and business justification for governance',
              maintenance: 'Regularly review and update subscriptions as business needs change',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to create subscription: ${error}`);
        }
      },
    });
  },
});