# Client Portfolio Optimization Dashboard

A comprehensive React-based dashboard for government relations attorneys to analyze client portfolios, model succession scenarios, and receive AI-driven strategic recommendations.

## 🚀 Features

### 📊 **Data Management**
- **CSV Upload**: Drag-and-drop interface for client data import
- **Sample Data**: Download template CSV with proper format
- **Data Validation**: Automatic validation and error handling
- **Data Persistence**: Client data saved locally for session continuity

### 📈 **Dashboard Analytics**
- **Overview Metrics**: Total revenue, client count, strategic value, risk assessment
- **Strategic Analysis**: Scatter plot visualization of strategic value vs time commitment
- **Client Rankings**: Sortable table ranking clients by strategic value
- **Portfolio Composition**: Pie chart breakdown by practice areas

### 👥 **Client Enhancement**
- **Detailed Client Profiles**: View and edit comprehensive client information
- **Practice Area Selection**: Multi-select checkboxes for practice areas
- **Relationship Metrics**: Sliders for relationship strength, renewal probability, strategic fit
- **Risk Assessment**: Conflict risk evaluation and time commitment tracking
- **Notes Management**: Free-text notes for additional client insights

### 🤖 **AI Strategic Advisor**
- **Portfolio Analysis**: AI-powered analysis of entire client portfolio
- **Strategic Recommendations**: Personalized advice based on client data
- **Client-Specific Insights**: Targeted recommendations for individual clients
- **Risk Mitigation**: AI suggestions for managing portfolio risks

### 🎯 **Scenario Modeling**
- **Succession Planning**: Model impact of attorney departures on client relationships
- **Capacity Optimization**: Optimize portfolio efficiency and resource allocation
- **Growth Modeling**: Plan growth scenarios to reach revenue targets
- **Interactive Controls**: Sliders and parameters for scenario customization
- **Feasibility Analysis**: Automatic assessment of scenario viability

## 📋 **CSV Data Format**

Your CSV file should include the following columns:

```csv
CLIENT,Contract Period,2023 Contract Value,2024 Contract Value,Hours/Month,Practice Area,Relationship Strength,Conflict Risk,Time Commitment,Renewal Probability,Strategic Fit Score,Notes
```

### Column Descriptions:
- **CLIENT**: Client name (required)
- **Contract Period**: Multi-year, Annual, Project-based, Retainer
- **2023/2024 Contract Value**: Numeric values for revenue
- **Hours/Month**: Monthly time commitment (numeric)
- **Practice Area**: Healthcare, Energy, Non-profit, Legal, etc.
- **Relationship Strength**: 1-10 scale
- **Conflict Risk**: Low, Medium, High
- **Time Commitment**: Low, Medium, High
- **Renewal Probability**: 0-100 percentage
- **Strategic Fit Score**: 1-10 scale
- **Notes**: Free text for additional information

## 🛠️ **Installation & Setup**

### Prerequisites
- Node.js 20.x or higher
- npm or pnpm package manager

### Backend Setup
```bash
cd backend
npm install
npm start
```
The backend will run on `http://localhost:5000`

### Frontend Setup
```bash
cd frontend
pnpm install
pnpm run dev
```
The frontend will run on `http://localhost:5173`

### Environment Configuration
Create a `.env` file in the backend directory:
```env
PORT=5000
ANTHROPIC_API_KEY=your_claude_api_key_here
```

## 📖 **User Guide**

### Getting Started
1. **Upload Data**: Start by uploading your client CSV file or download the sample template
2. **Review Dashboard**: Explore the overview metrics and visualizations
3. **Enhance Clients**: Add detailed information for strategic analysis
4. **Run Scenarios**: Model different business scenarios
5. **Get AI Insights**: Use the AI advisor for strategic recommendations

### Navigation
- **Data Upload**: Import and manage client data
- **Dashboard**: View analytics and visualizations
- **Client Details**: Enhance client profiles and relationships
- **AI Advisor**: Get strategic recommendations
- **Scenarios**: Model business scenarios and optimization

### Dashboard Tabs
- **Overview**: Key metrics and portfolio composition
- **Strategic Analysis**: Strategic value vs time commitment scatter plot
- **Client Rankings**: Sortable table of clients by strategic value

### Scenario Types
- **Succession Planning**: Model attorney departure impact
- **Capacity Optimization**: Optimize resource allocation
- **Growth Modeling**: Plan revenue growth scenarios

## 🔧 **Technical Architecture**

### Frontend
- **React 18**: Modern React with hooks and functional components
- **Zustand**: Lightweight state management
- **Recharts**: Data visualization library
- **Tailwind CSS**: Utility-first CSS framework
- **Shadcn/UI**: High-quality UI components
- **Lucide Icons**: Beautiful icon library

### Backend
- **Node.js**: JavaScript runtime
- **Express**: Web application framework
- **Anthropic SDK**: Claude AI integration
- **CORS**: Cross-origin resource sharing
- **CSV Processing**: Papaparse for data handling

### Data Flow
1. CSV upload → Frontend parsing → Backend processing
2. Client data → Zustand store → Component rendering
3. User interactions → State updates → Real-time UI updates
4. AI requests → Backend → Anthropic API → Formatted responses

## 🚀 **Deployment**

### Production Build
```bash
# Frontend
cd frontend
pnpm run build

# Backend (ensure environment variables are set)
cd backend
npm start
```

### Environment Variables
- `ANTHROPIC_API_KEY`: Required for AI functionality
- `PORT`: Backend server port (default: 5000)

## 🔒 **Security & Privacy**

- **Local Data Storage**: Client data stored locally in browser
- **No Data Transmission**: Sensitive data never leaves your environment
- **API Key Security**: Anthropic API key stored securely in backend environment
- **CORS Protection**: Configured for secure cross-origin requests

## 🆘 **Troubleshooting**

### Common Issues
1. **Application won't load**: Check console for JavaScript errors
2. **CSV upload fails**: Verify CSV format matches template
3. **AI features not working**: Ensure ANTHROPIC_API_KEY is set
4. **Charts not displaying**: Check data format and browser compatibility

### Support
- Check browser console for error messages
- Verify all dependencies are installed
- Ensure both frontend and backend servers are running
- Confirm CSV data format matches requirements

## 📄 **License**

© 2025 Gaffney, Bennett & Associates - Portfolio Optimization Dashboard
Built with React & AI

---

**Built for government relations professionals who need strategic insights and data-driven decision making.**

