## Practice Area Pie Chart Fix - Testing Instructions

### What was fixed:
The issue was that clients fetched from the database had field names using snake_case (`practice_area`) but the frontend expected camelCase (`practiceArea`). This caused all clients to be categorized as "Not Specified" in the practice area pie chart.

### Changes made:
1. **data.cjs** - Added field transformation in 3 routes:
   - GET `/clients` - Transform database fields to frontend format
   - POST `/clients` - Transform for new client creation
   - PUT `/clients/:id` - Transform for client updates

### To test the fix:

1. **Open the application** at http://localhost:5000
2. **Navigate to the Dashboard** tab
3. **Add some test clients** with different practice areas:
   - Client 1: Practice Areas = Healthcare, Corporate
   - Client 2: Practice Areas = Municipal  
   - Client 3: Practice Areas = Energy, Financial
   - Client 4: No practice areas (should show as "Not Specified")

4. **Check the pie chart** - It should now show:
   - Healthcare: X% revenue
   - Corporate: X% revenue  
   - Municipal: X% revenue
   - Energy: X% revenue
   - Financial: X% revenue
   - Not Specified: X% revenue (only for clients without practice areas)

### Before the fix:
- Pie chart showed 100% "Not Specified"

### After the fix:
- Pie chart correctly shows distribution across actual practice areas
- Only clients without practice areas show as "Not Specified"

The field transformation ensures that:
```javascript
// Database format:
{ practice_area: ['Healthcare', 'Corporate'] }

// Gets transformed to frontend format:
{ practiceArea: ['Healthcare', 'Corporate'] }
```

This allows the DashboardView.jsx aggregation logic to work correctly:
```javascript
if (client.practiceArea && Array.isArray(client.practiceArea) && client.practiceArea.length > 0) {
  client.practiceArea.forEach(area => {
    // Now this works correctly!
  });
}
```
