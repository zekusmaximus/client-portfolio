/**
 * Partnership Export Utilities
 * Production-ready export functions with no external dependencies
 * Handles edge cases and provides fallback values
 */

// Utility function to safely format revenue
const formatRevenue = (revenue) => {
  if (!revenue || isNaN(revenue)) return '$0';
  if (revenue >= 1000000) return `$${(revenue / 1000000).toFixed(1)}M`;
  if (revenue >= 1000) return `$${(revenue / 1000).toFixed(0)}K`;
  return `$${Math.round(revenue)}`;
};

// Utility to safely get client revenue
const getClientRevenue = (client, getRevenueFunc) => {
  if (!client) return 0;
  try {
    return getRevenueFunc ? getRevenueFunc(client) : (client.revenue || 0);
  } catch (error) {
    console.warn('Error getting client revenue:', error);
    return 0;
  }
};

// Utility to escape HTML content
const escapeHtml = (text) => {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

/**
 * Export comprehensive partnership report as PDF-ready HTML
 */
export const exportPartnershipPDF = (partners, transitions, clients, getRevenueFunc) => {
  try {
    // Validate inputs with fallbacks
    const safePartners = Array.isArray(partners) ? partners : [];
    const safeTransitions = transitions || {};
    const safeClients = Array.isArray(clients) ? clients : [];

    const styles = `
      <style>
        @media print {
          body { 
            margin: 0; 
            font-family: Arial, sans-serif; 
            line-height: 1.4;
            color: #333;
          }
          .page-break { 
            page-break-after: always; 
          }
          .no-print { 
            display: none; 
          }
          table { 
            width: 100%; 
            border-collapse: collapse; 
            margin-bottom: 20px;
          }
          th, td { 
            border: 1px solid #ddd; 
            padding: 8px; 
            text-align: left;
            vertical-align: top;
          }
          th { 
            background-color: #f2f2f2; 
            font-weight: bold;
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 3px solid #333;
          }
          .section {
            margin-bottom: 30px;
          }
          .partner-section {
            margin-bottom: 25px;
            padding: 15px;
            border: 1px solid #ddd;
            border-radius: 5px;
          }
          .summary-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
            margin-bottom: 20px;
          }
          .summary-item {
            padding: 10px;
            background-color: #f9f9f9;
            border-radius: 5px;
          }
          .departing {
            background-color: #ffe6e6;
          }
          .active {
            background-color: #e6f7ff;
          }
        }
        @media screen {
          body {
            font-family: Arial, sans-serif;
            margin: 20px;
            line-height: 1.6;
          }
        }
      </style>
    `;

    // Generate executive summary
    const totalPartners = safePartners.length;
    const departingPartners = safePartners.filter(p => p?.isDeparting);
    const remainingPartners = safePartners.filter(p => !p?.isDeparting);
    const totalRevenue = safePartners.reduce((sum, p) => sum + (p?.totalRevenue || 0), 0);
    const departingRevenue = departingPartners.reduce((sum, p) => sum + (p?.totalRevenue || 0), 0);
    
    const clientsToMove = departingPartners.reduce((sum, p) => sum + (p?.clients?.length || 0), 0);

    const generateExecutiveSummary = () => `
      <div class="section">
        <h2>Executive Summary</h2>
        <div class="summary-grid">
          <div class="summary-item">
            <strong>Total Partners:</strong> ${totalPartners}
          </div>
          <div class="summary-item">
            <strong>Departing Partners:</strong> ${departingPartners.length}
          </div>
          <div class="summary-item">
            <strong>Remaining Partners:</strong> ${remainingPartners.length}
          </div>
          <div class="summary-item">
            <strong>Total Portfolio Revenue:</strong> ${formatRevenue(totalRevenue)}
          </div>
          <div class="summary-item">
            <strong>Revenue at Risk:</strong> ${formatRevenue(departingRevenue)}
          </div>
          <div class="summary-item">
            <strong>Clients to Redistribute:</strong> ${clientsToMove}
          </div>
        </div>
        
        ${departingRevenue > 0 ? `
          <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin-top: 15px;">
            <strong>Risk Assessment:</strong> ${((departingRevenue / Math.max(1, totalRevenue)) * 100).toFixed(1)}% 
            of total revenue requires redistribution. ${clientsToMove > 20 ? 'High complexity transition expected.' : 'Moderate complexity transition.'}
          </div>
        ` : ''}
      </div>
    `;

    // Generate partner detail section
    const generatePartnerSection = (partner) => {
      if (!partner) return '';
      
      const partnerClients = (partner.clients || [])
        .map(clientId => safeClients.find(c => c?.id === clientId))
        .filter(Boolean);

      const partnerRevenue = partnerClients.reduce((sum, client) => {
        return sum + getClientRevenue(client, getRevenueFunc);
      }, 0);

      return `
        <div class="partner-section ${partner.isDeparting ? 'departing' : 'active'}">
          <h3>${escapeHtml(partner.name || 'Unknown Partner')} 
            ${partner.isDeparting ? '(Departing)' : '(Active)'}
          </h3>
          <div class="summary-grid">
            <div>
              <strong>Total Revenue:</strong> ${formatRevenue(partnerRevenue)}
            </div>
            <div>
              <strong>Client Count:</strong> ${partnerClients.length}
            </div>
            <div>
              <strong>Capacity Used:</strong> ${Math.round(partner.capacityUsed || 0)}%
            </div>
            <div>
              <strong>Practice Areas:</strong> ${(partner.practiceAreas || []).join(', ') || 'None specified'}
            </div>
          </div>
          
          ${partnerClients.length > 0 ? `
            <h4>Client Portfolio</h4>
            <table>
              <thead>
                <tr>
                  <th>Client Name</th>
                  <th>Revenue</th>
                  <th>Strategic Value</th>
                  <th>Status</th>
                  <th>Practice Areas</th>
                </tr>
              </thead>
              <tbody>
                ${partnerClients.map(client => {
                  const revenue = getClientRevenue(client, getRevenueFunc);
                  const practiceAreas = Array.isArray(client.practice_area) ? 
                    client.practice_area.join(', ') : (client.practice_area || 'Not specified');
                  
                  return `
                    <tr>
                      <td>${escapeHtml(client.name || 'Unknown')}</td>
                      <td>${formatRevenue(revenue)}</td>
                      <td>${client.strategic_value ? client.strategic_value.toFixed(1) : 'N/A'}</td>
                      <td>${escapeHtml(client.status || 'Unknown')}</td>
                      <td>${escapeHtml(practiceAreas)}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          ` : '<p><em>No clients assigned</em></p>'}
        </div>
      `;
    };

    // Generate transition plan if assignments exist
    const generateTransitionPlan = () => {
      const assignments = safeTransitions.customAssignments || {};
      const assignmentEntries = Object.entries(assignments);
      
      if (assignmentEntries.length === 0) {
        return '<div class="section"><h2>Transition Plan</h2><p><em>No client reassignments planned</em></p></div>';
      }

      return `
        <div class="section">
          <h2>Transition Plan</h2>
          <table>
            <thead>
              <tr>
                <th>Client Name</th>
                <th>Current Partner</th>
                <th>New Partner</th>
                <th>Revenue Impact</th>
                <th>Strategic Value</th>
                <th>Practice Areas</th>
              </tr>
            </thead>
            <tbody>
              ${assignmentEntries.map(([clientId, newPartnerId]) => {
                const client = safeClients.find(c => c?.id === clientId);
                const currentPartner = safePartners.find(p => p?.clients?.includes(clientId));
                const newPartner = safePartners.find(p => p?.id === newPartnerId);
                const revenue = getClientRevenue(client, getRevenueFunc);
                const practiceAreas = Array.isArray(client?.practice_area) ? 
                  client.practice_area.join(', ') : (client?.practice_area || 'Not specified');
                
                return `
                  <tr>
                    <td>${escapeHtml(client?.name || 'Unknown Client')}</td>
                    <td>${escapeHtml(currentPartner?.name || 'Unknown')}</td>
                    <td>${escapeHtml(newPartner?.name || 'Unknown')}</td>
                    <td>${formatRevenue(revenue)}</td>
                    <td>${client?.strategic_value ? client.strategic_value.toFixed(1) : 'N/A'}</td>
                    <td>${escapeHtml(practiceAreas)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    };

    // Assemble complete HTML document
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Partnership Transition Report - ${new Date().toLocaleDateString()}</title>
          ${styles}
        </head>
        <body>
          <div class="header">
            <h1>Partnership Transition Analysis</h1>
            <p>Generated: ${new Date().toLocaleString()}</p>
            <p><strong>Confidential Document - Internal Use Only</strong></p>
          </div>
          
          ${generateExecutiveSummary()}
          <div class="page-break"></div>
          
          <div class="section">
            <h2>Partner Portfolio Details</h2>
            ${safePartners.map(generatePartnerSection).join('')}
          </div>
          <div class="page-break"></div>
          
          ${generateTransitionPlan()}
          
          <div class="section" style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #ddd;">
            <h2>Report Notes</h2>
            <ul>
              <li>Revenue figures represent 2025 projections based on current data</li>
              <li>Capacity calculations assume 30 clients = 100% capacity benchmark</li>
              <li>Strategic values rated on 1-10 scale (10 = highest strategic importance)</li>
              <li>This analysis is based on data as of ${new Date().toLocaleDateString()}</li>
            </ul>
          </div>
        </body>
      </html>
    `;

    // Open in new window for printing
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      
      // Auto-print after content loads
      setTimeout(() => {
        printWindow.print();
      }, 500);
    } else {
      throw new Error('Unable to open print window. Please check popup blocker settings.');
    }

  } catch (error) {
    console.error('Error generating PDF report:', error);
    alert(`Export failed: ${error.message}`);
  }
};

/**
 * Export transition plan as CSV file
 */
export const exportTransitionPlan = (assignments, partners, clients, getRevenueFunc) => {
  try {
    // Validate inputs with fallbacks
    const safeAssignments = assignments || {};
    const safePartners = Array.isArray(partners) ? partners : [];
    const safeClients = Array.isArray(clients) ? clients : [];

    // CSV Headers
    const headers = [
      'Client Name',
      'Client ID', 
      'Current Partner',
      'New Partner',
      'Revenue',
      'Strategic Value',
      'Practice Areas',
      'Status',
      'Transition Priority'
    ];

    // Generate CSV rows
    const rows = [headers];
    
    Object.entries(safeAssignments).forEach(([clientId, newPartnerId]) => {
      const client = safeClients.find(c => c?.id === clientId);
      const currentPartner = safePartners.find(p => p?.clients?.includes(clientId));
      const newPartner = safePartners.find(p => p?.id === newPartnerId);
      
      const revenue = getClientRevenue(client, getRevenueFunc);
      const practiceAreas = Array.isArray(client?.practice_area) ? 
        client.practice_area.join('; ') : (client?.practice_area || '');
      
      // Determine transition priority based on strategic value and revenue
      let priority = 'Low';
      const strategicValue = client?.strategic_value || 0;
      if (strategicValue > 7 || revenue > 1000000) priority = 'High';
      else if (strategicValue > 5 || revenue > 500000) priority = 'Medium';

      rows.push([
        client?.name || 'Unknown Client',
        clientId || '',
        currentPartner?.name || 'Unknown',
        newPartner?.name || 'Unknown', 
        revenue.toFixed(2),
        strategicValue.toFixed(1),
        practiceAreas,
        client?.status || 'Unknown',
        priority
      ]);
    });

    // Handle empty assignments case
    if (rows.length === 1) {
      rows.push(['No client reassignments planned', '', '', '', '0', '0', '', '', 'N/A']);
    }

    // Convert to CSV format with proper escaping
    const csvContent = rows.map(row => 
      row.map(cell => {
        // Convert to string and escape quotes
        const cellStr = String(cell || '');
        // If cell contains comma, quotes, or newlines, wrap in quotes and escape internal quotes
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(',')
    ).join('\n');

    // Add BOM for Excel compatibility
    const BOM = '\uFEFF';
    const csvWithBOM = BOM + csvContent;

    // Create and download file
    const blob = new Blob([csvWithBOM], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `transition_plan_${new Date().toISOString().split('T')[0]}.csv`;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Cleanup
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);

  } catch (error) {
    console.error('Error exporting transition plan:', error);
    alert(`Export failed: ${error.message}`);
  }
};

/**
 * Export partner capacity analysis as CSV
 */
export const exportCapacityAnalysis = (partners, clients, getRevenueFunc) => {
  try {
    const safePartners = Array.isArray(partners) ? partners : [];
    const safeClients = Array.isArray(clients) ? clients : [];

    const headers = [
      'Partner Name',
      'Status',
      'Current Clients',
      'Total Revenue',
      'Capacity Used (%)',
      'Practice Areas',
      'Avg Strategic Value',
      'High Value Clients',
      'Revenue per Client'
    ];

    const rows = [headers];

    safePartners.forEach(partner => {
      if (!partner) return;
      
      const partnerClients = (partner.clients || [])
        .map(clientId => safeClients.find(c => c?.id === clientId))
        .filter(Boolean);
      
      const totalRevenue = partnerClients.reduce((sum, client) => {
        return sum + getClientRevenue(client, getRevenueFunc);
      }, 0);
      
      const avgStrategicValue = partnerClients.length > 0 ? 
        partnerClients.reduce((sum, c) => sum + (c?.strategic_value || 0), 0) / partnerClients.length : 0;
      
      const highValueClients = partnerClients.filter(c => (c?.strategic_value || 0) > 7).length;
      const revenuePerClient = partnerClients.length > 0 ? totalRevenue / partnerClients.length : 0;

      rows.push([
        partner.name || 'Unknown',
        partner.isDeparting ? 'Departing' : 'Active',
        partnerClients.length.toString(),
        totalRevenue.toFixed(2),
        Math.round(partner.capacityUsed || 0).toString(),
        (partner.practiceAreas || []).join('; '),
        avgStrategicValue.toFixed(1),
        highValueClients.toString(),
        revenuePerClient.toFixed(2)
      ]);
    });

    const csvContent = rows.map(row => 
      row.map(cell => {
        const cellStr = String(cell || '');
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(',')
    ).join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `capacity_analysis_${new Date().toISOString().split('T')[0]}.csv`;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);

  } catch (error) {
    console.error('Error exporting capacity analysis:', error);
    alert(`Export failed: ${error.message}`);
  }
};