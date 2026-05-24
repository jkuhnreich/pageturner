{
  "name": "bookfinder",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "server": "node server.mjs",
    "client": "vite --config frontend/vite.config.js",
    "dev": "node server.mjs & cd frontend && npx vite"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.2",
    "multer": "^1.4.5-lts.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "vite": "^6.1.0"
  }
}

