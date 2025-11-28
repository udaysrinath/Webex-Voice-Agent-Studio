# Webex AI Podcaster

## Overview

Webex AI Podcaster is a full-stack web application for designing and evaluating personalized voice agents for the Webex ecosystem. The platform enables users to create custom AI-powered podcaster agents by selecting LLM models, voice models, languages, and other persona attributes. Users can then evaluate these agents by generating speech samples and rating them across multiple quality dimensions (naturalness, clarity, intonation, speed).

The application is built as a modern single-page application (SPA) with a React frontend and Express backend, using PostgreSQL for persistent storage and integrating with OpenAI's API for text-to-speech capabilities.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Build System**
- React 18 with TypeScript for type safety and component-based UI development
- Vite as the build tool and development server, providing fast HMR and optimized production builds
- Wouter for lightweight client-side routing (instead of React Router)
- TanStack Query (React Query) for server state management, caching, and API request handling

**UI Component Library**
- shadcn/ui components built on Radix UI primitives for accessible, customizable components
- Tailwind CSS v4 for utility-first styling with custom design tokens
- Custom theming system using CSS variables for colors, spacing, and borders
- Framer Motion for animations and transitions

**State Management Strategy**
- TanStack Query handles all server state (agents, evaluations) with automatic caching and refetching
- Local React state (useState) for UI interactions and form data
- No global state management library - server state and local state are sufficient for this application's needs

**Key Design Patterns**
- Component composition with shadcn/ui's slot pattern for flexible, reusable components
- Custom hooks (useToast, useIsMobile) for shared logic
- API client layer in `client/src/lib/api.ts` that abstracts fetch calls and provides typed interfaces

### Backend Architecture

**Server Framework**
- Express.js with TypeScript for the REST API server
- Middleware pipeline for JSON parsing, logging, and error handling
- Request body capture for detailed logging of API responses

**API Design**
- RESTful endpoints following resource-based patterns:
  - `/api/agents` - CRUD operations for podcaster agents
  - `/api/evaluations` - CRUD operations for agent evaluations
  - `/api/tts` - Text-to-speech generation endpoint
- Validation using Zod schemas with helpful error messages via zod-validation-error
- Consistent error handling with appropriate HTTP status codes

**Data Access Layer**
- Storage abstraction through `IStorage` interface in `server/storage.ts`
- `DatabaseStorage` implementation provides concrete database operations
- This pattern allows for easy testing and potential database swapping

### Database Architecture

**ORM & Schema Management**
- Drizzle ORM for type-safe database queries and schema management
- PostgreSQL as the primary database (via Neon serverless)
- Schema defined in `shared/schema.ts` for shared types between frontend and backend
- Drizzle Kit for migrations and schema synchronization

**Database Schema**
The application has three core tables:

1. **users** - User authentication (currently defined but not fully implemented)
   - Stores username and password for future authentication features
   
2. **agents** - Podcaster agent configurations
   - Stores LLM model, voice model, language, gender selections
   - Timestamps for creation tracking
   
3. **evaluations** - Quality ratings for agent speech samples
   - Links to agents via foreign key
   - Stores input text and four rating dimensions (naturalness, clarity, intonation, speed)
   - Timestamps for evaluation tracking

**Schema Sharing Strategy**
- Drizzle schemas exported from `shared/schema.ts`
- Zod schemas generated via `drizzle-zod` for runtime validation
- TypeScript types inferred from Drizzle schemas for compile-time safety
- This ensures frontend, backend, and database stay synchronized

### Development Environment

**Monorepo Structure**
- Single repository with client, server, and shared code
- TypeScript configuration with path aliases (@, @shared, @assets)
- Shared types and schemas in `/shared` directory accessed by both frontend and backend

**Build & Deployment**
- Development: Separate Vite dev server (port 5000) and Express server
- Production: Vite builds static assets, esbuild bundles server into single file
- Static files served from Express in production

**Replit Integration**
- Custom Vite plugins for Replit-specific features (cartographer, dev banner, runtime error overlay)
- Environment-specific plugin loading to avoid production overhead

## External Dependencies

### Third-Party Services

**OpenAI API**
- Used for text-to-speech generation via the TTS API
- Supports multiple voice models (alloy, echo, fable, onyx, nova, shimmer)
- Two quality tiers available (tts-1, tts-1-hd)
- API key required via `OPENAI_API_KEY` environment variable
- Client instantiated only when API key is present, allowing graceful degradation

**Neon Serverless PostgreSQL**
- Managed PostgreSQL database with serverless architecture
- WebSocket-based connections via `@neondatabase/serverless`
- Connection pooling for efficient resource usage
- Database URL configured via `DATABASE_URL` environment variable

### Key NPM Dependencies

**UI & Styling**
- `@radix-ui/*` - Headless UI primitives for accessibility and customization
- `tailwindcss` - Utility-first CSS framework
- `class-variance-authority` & `clsx` - Conditional className utilities
- `lucide-react` - Icon library

**Forms & Validation**
- `react-hook-form` - Form state management
- `@hookform/resolvers` - Validation resolver utilities
- `zod` - Schema validation for runtime type checking
- `drizzle-zod` - Automatic Zod schema generation from Drizzle schemas

**Data Fetching**
- `@tanstack/react-query` - Server state management and caching

**Database**
- `drizzle-orm` - TypeScript ORM
- `drizzle-kit` - Migration and schema management CLI
- `@neondatabase/serverless` - Neon PostgreSQL client with WebSocket support

**Session Management (Configured but Not Active)**
- `connect-pg-simple` - PostgreSQL session store for Express sessions
- Infrastructure is in place for future authentication implementation

### Asset Management

The application includes a custom assets directory (`attached_assets`) for storing generated images and other media files, accessible via the `@assets` path alias in Vite configuration.