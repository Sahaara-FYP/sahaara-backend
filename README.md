# Sahaara Backend

This is the backend for Sahaara, a smart, real-time, hyperlocal community support platform.

## Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
- npm (or yarn/pnpm)

### Installation
1. Navigate to the backend directory:
   ```bash
   cd sahaara-backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables:
   Create a `.env` file in the root directory and configure the necessary environment variables (e.g., Database URL, Supabase keys, JWT secret).

### Database Setup (Prisma)
Before running the server, ensure your database is set up and the Prisma client is generated:
```bash
# Generate Prisma client
npx prisma generate

# Apply migrations / push schema to your database
npx prisma migrate dev
# OR npx prisma db push
```

### Running the Application

**Development Mode**
Starts the development server with hot-reloading using `nodemon` and `tsx`.
```bash
npm run dev
```

**Production Build**
Compiles TypeScript code into the `dist` directory.
```bash
npm run build
```

**Start Production Server**
Runs the compiled JavaScript from the `dist` folder. (Requires `npm run build` to be run first).
```bash
npm start
```
