# Use official Node.js long-term support image
FROM node:18

# Set working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install all dependencies (including devDependencies like concurrently for npm start)
RUN npm install

# Copy the rest of the application source code
COPY . .

# Expose the port the dashboard runs on (default to 3000)
EXPOSE 3000

# Start the application using concurrently to run both index.js and dashboard.js
CMD ["npm", "start"]
