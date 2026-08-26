<<<<<<< HEAD
 AgapSense System

Welcome to the AgapSense System! This document serves as a comprehensive guide to the project's architecture, codebase, and features. It is specifically designed to help explain the system during panel presentations and code reviews.

  Project Overview
AgapSense is a comprehensive, role-based fire alert and monitoring system designed to bridge the gap between residents, local authorities (BFP - Bureau of Fire Protection), and system administrators. The platform provides real-time monitoring, alert management, and device tracking to ensure swift responses to fire incidents.

  Technology Stack
- Frontend Framework: React 19 with TypeScript
- Build Tool: Vite
- Styling: TailwindCSS v4
- Routing: React Router v7
- Mapping & Location: Leaflet & React-Leaflet
- Icons: Lucide React
- Backend & Database: Supabase (PostgreSQL, Authentication, Row Level Security)

---

  System Architecture & Role-Based Access Control (RBAC)
The system is built on a robust RBAC model to ensure users only see and interact with data relevant to their role. 

The application relies on a centralized `AuthContext` to manage user sessions and an `AuthGuard` component to secure routes based on user roles.

 The 3 Main Roles:
1. Admin (`admin`): Has full oversight of the system, including user management, all devices, and global logs.
2. BFP Responder (`bfp_responder`): Focuses on active alerts, team coordination, and dispatching.
3. Resident (`resident`): Focuses on managing their home devices, personal alert settings, and viewing local logs.

---

  Code Structure & Core Components

 1. Routing & Security (`src/App.tsx` & `src/components/AuthGuard.tsx`)
- `App.tsx`: Acts as the central router for the application. It defines public routes (like `/login`) and secure routes grouped by roles.
- `AuthGuard.tsx`: A Higher-Order Component (HOC) that wraps protected routes. It checks the user's current session and role. If a user tries to access an unauthorized route, they are redirected appropriately.

 2. State Management (`src/contexts/AuthContext.tsx`)
- Handles the connection to Supabase Auth.
- Exposes user data and roles to the rest of the application so the UI can adapt dynamically.

 3. Layouts (`src/components/Layout.tsx`)
To keep the code DRY (Don't Repeat Yourself), each role has a dedicated layout component (`AdminLayout`, `ResponderLayout`, `ResidentLayout`). These layouts contain the navigation sidebars or headers specific to that role, wrapping the page content (`Outlet`).

---

  Features by User Role (The "Pages")

  Admin Module
The Admin routes are mounted under `/admin` or `/dashboard`.
- Dashboard (`Dashboard.tsx`): The high-level overview of system health, total alerts, and active devices.
- Interactive Map (`InteractiveMap.tsx`): A real-time geographical view (using Leaflet) showing device locations and active fire hotspots.
- Device Management (`Devices.tsx`): CRUD operations for hardware sensors connected to the system.
- User Management (`Users.tsx`): Allows the admin to approve, reject, or manage BFP Responders and Residents.
- Alerts & Logs (`Alerts.tsx`, `Logs.tsx`): A master view of all historical and active alerts and system logs.

  BFP Responder Module
The Responder routes are mounted under `/responder`.
- Responder Dashboard (`ResponderDashboard.tsx`): Tailored for emergency response, highlighting immediate action items and active alarms.
- Alert Logs (`ResponderAlertLogs.tsx`): Detailed view of incident reports, allowing responders to track the status of fires (e.g., dispatching, resolved).
- Team Management (`ResponderTeam.tsx`): View active personnel on duty or available for dispatch.
- Device Status (`ResponderDevices.tsx`): Checking the operational status of fire nodes/sensors in the field.

  Resident Module
The Resident routes are mounted under `/home` or `/account`.
- Setup (`ResidentSetup.tsx`): Initial onboarding flow for new users to register their location and devices.
- Resident Home (`ResidentHome.tsx`): The primary view showing the status of their specific home and devices.
- Alert Settings (`ResidentAlertSettings.tsx`): Configuration for how they receive notifications (e.g., SMS, push notifications).
- Device Info & Logs (`ResidentDeviceInfo.tsx`, `ResidentSystemLog.tsx`): Localized monitoring of their own hardware sensors.

---

  Backend Integration (Supabase)
- `src/lib/supabase.ts`: Initializes the Supabase client using environment variables (`.env`).
- Authentication: Email/Password login flows are handled directly through Supabase Auth.
- Database (PostgreSQL): The frontend interacts with Supabase tables via the Javascript client. Security is enforced at the database level using Row Level Security (RLS), ensuring a Resident cannot fetch another Resident's data, even if they manipulate the frontend code.

---

  How to Run Locally for Demonstration

1. Install Dependencies:
   ```bash
   npm install
   ```
2. Set Environment Variables:
   Ensure your `.env` file contains your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=your_project_url
   VITE_SUPABASE_ANON_KEY=your_anon_key
   ```
3. Start the Development Server:
   ```bash
   npm run dev
   ```
4. View Application: Open `http://localhost:5173` in your browser.