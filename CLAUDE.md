# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Frontend Development
- `npm run dev` - Start Vite development server for React frontend
- `npm run build` - Build production React app
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint on JS/JSX files

### Backend Development
- `npm start` or `node server.cjs` - Start Express.js backend server on port 5000
- Backend runs on http://localhost:5000 with CORS enabled for development

### Testing
- No specific test framework is configured - check with user before implementing tests

## Architecture Overview

This is a **Client Portfolio Optimization Dashboard** for government relations attorneys, consisting of:

### Frontend (React + Vite)
- **Framework**: React 18 with Vite bundler
- **State Management**: Zustand with localStorage persistence (`src/portfolioStore.js`)
- **UI Library**: Shadcn/UI components with Tailwind CSS
- **Charts**: Recharts for data visualizations
- **Main Entry**: `src/main.jsx` renders `src/App.jsx`

### Backend (Node.js + Express)
- **Server**: Express.js server in `server.cjs` (port 5000)
- **API Routes**: 
  - `/api/claude/*` - AI integration endpoints (`claude.cjs`)
  - `/api/data/*` - Data processing endpoints (`data.cjs`)
- **Data Processing**: Client analysis engine in `clientAnalyzer.cjs`

### Key Application Components

#### Core Views (Tab-based Navigation)
1. **Data Upload** (`DataUploadManager.jsx`) - CSV import with drag-and-drop
2. **Dashboard** (`DashboardView.jsx`) - Analytics and visualizations
3. **Client Details** (`ClientListView.jsx` + `ClientEnhancementForm.jsx`) - Client management
4. **AI Advisor** (`AIAdvisor.jsx`) - Claude API integration for strategic advice
5. **Scenarios** (`ScenarioModeler.jsx`) - Business scenario modeling

#### Data Flow
1. CSV upload → `data.cjs` processes via `clientAnalyzer.cjs`
2. Client data stored in Zustand store with localStorage persistence
3. Strategic value calculations use weighted algorithms in `clientAnalyzer.cjs:calculateStrategicValue`
4. AI endpoints require `ANTHROPIC_API_KEY` environment variable

## Strategic Value Calculation

The core business logic calculates client strategic value using:
- Revenue score (20%)
- Relationship intensity (30%) 
- Strategic fit score (15%)
- Renewal probability (15%)
- Crisis management needs (10%)
- Growth score (10%)
- Minus conflict risk penalty

Formula implemented in `clientAnalyzer.cjs:calculateStrategicValue` and `data.cjs:calculateStrategicValue`.

## File Structure Context

### Backend Files
- `server.cjs` - Main Express server with route registration
- `claude.cjs` - AI integration with Anthropic Claude API
- `data.cjs` - Data processing API endpoints
- `clientAnalyzer.cjs` - Core business logic and calculations

### Frontend Structure
- `src/App.jsx` - Main application with tab navigation
- `src/portfolioStore.js` - Zustand state management
- `src/components/ui/` - Reusable UI components (button, card, etc.)
- Core feature components at `src/` root level

## Environment Configuration

### Required Environment Variables
- `ANTHROPIC_API_KEY` - For AI functionality (Claude API)
- `PORT` - Server port (defaults to 5000)
- `NODE_ENV` - Environment mode

### Vite Configuration
- API base URL configured as `http://localhost:5000` in `vite.config.js`
- Path alias `@` points to `./src`

## Development Notes

### State Management
- All client data persists in browser localStorage via Zustand
- Store includes clients array, UI state, and analytics cache
- Use `usePortfolioStore()` hook to access state in components

### API Integration
- Frontend calls backend APIs via `src/api.js`
- Backend serves both data processing and AI endpoints
- Error handling implemented throughout the stack

### Contract Status Logic
Contract periods are automatically parsed to derive status:
- 'IF' - In Force (current date within contract period)
- 'D' - Done (contract expired) 
- 'P' - Proposal (contract starts in future)
- 'H' - Hold (invalid/unparseable data)

## Common Development Patterns

### Adding New Client Fields
1. Update CSV processing in `clientAnalyzer.cjs:processCSVData`
2. Add field to strategic value calculation if relevant
3. Update UI forms in `ClientEnhancementForm.jsx`
4. Update state management in `portfolioStore.js`

### Adding New Visualizations
- Use Recharts library (already included)
- Add to `DashboardView.jsx` or create new component
- Follow existing chart patterns for data formatting

### AI Integration
- All AI prompts defined in `claude.cjs`
- Use portfolio summary format for consistency
- Handle API key missing gracefully with error messages