# Use the official Node.js image
FROM node:18

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the application code
COPY . .

# Expose any necessary ports (optional for a non-server app)
EXPOSE 3000

# Define the default command
CMD ["npm", "start"]