# Login System Setup Guide

## 🎯 **Complete Authentication System**

### **Features:**
- ✅ User registration and login
- ✅ JWT token authentication
- ✅ Protected routes
- ✅ User management
- ✅ Database seeder
- ✅ Beautiful UI

### **User Model Fields:**
- `username` - Unique username
- `password` - Hashed password
- `name` - Full name
- `email` - Unique email
- `isActive` - Account status
- `lastLogin` - Last login timestamp

## 🚀 **Setup Instructions**

### **1. Install Dependencies**
```bash
npm install bcryptjs jsonwebtoken
```

### **2. Database Setup**
```bash
# Setup database with all indexes
npm run setup-db

# Check user statistics
npm run seed-users
```

### **3. Environment Variables**
Create `.env` file:
```env
MONGODB_URI=mongodb://localhost:27017/crypto-alerts
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d
```

### **4. Start Services**
```bash
# Start all services
npm run dev:all

# Or individually:
npm run dev          # Next.js app
npm run worker       # Binance data worker
npm run alert-worker # Alert evaluation worker
```

## 👤 **User Management**

Users can be created through the registration system or by administrators.

## 🔐 **Authentication Flow**

### **1. Login Process**
```javascript
// User submits login form
const response = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password })
});

// Server returns JWT token
const { token, user } = await response.json();

// Store token in localStorage
localStorage.setItem('token', token);
localStorage.setItem('user', JSON.stringify(user));
```

### **2. Protected Routes**
```javascript
// Middleware checks for token
const token = localStorage.getItem('token');
if (!token) {
  router.push('/login');
}

// API calls include token
const response = await fetch('/api/alerts', {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

### **3. Logout Process**
```javascript
// Clear stored data
localStorage.removeItem('token');
localStorage.removeItem('user');

// Redirect to login
router.push('/login');
```

## 📱 **Pages and Routes**

### **Public Routes**
- `/login` - Login page
- `/api/auth/login` - Login API
- `/api/auth/register` - Registration API

### **Protected Routes**
- `/dashboard` - Main dashboard
- `/api/alerts/*` - Alert management APIs
- `/api/alerts/history/*` - Alert history APIs

### **Middleware Protection**
```javascript
// middleware.js automatically protects routes
// Redirects to /login if no token
```

## 🎨 **UI Components**

### **Login Page** (`/login`)
- Beautiful gradient background
- Username/email and password fields
- Show/hide password toggle
- Error handling
- Responsive design

### **Dashboard Page** (`/dashboard`)
- Welcome message with user name
- Statistics cards
- Alert history table
- User menu with logout
- Protected content

### **Alert History Component**
- Real-time alert display
- Status management (acknowledge/dismiss)
- Statistics
- Pagination

## 🔧 **API Endpoints**

### **Authentication**
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `GET /api/auth/me` - Get current user

### **User Management**
- `GET /api/users` - Get all users (admin)
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Deactivate user

### **Alert Management** (Protected)
- `GET /api/alerts?userId=123` - Get user alerts
- `POST /api/alerts` - Create alert
- `PUT /api/alerts` - Update alert
- `DELETE /api/alerts` - Delete alert

### **Alert History** (Protected)
- `GET /api/alerts/history?userId=123` - Get alert history
- `PUT /api/alerts/history` - Update alert status
- `GET /api/alerts/history/stats?userId=123` - Get statistics

## 🧪 **Testing**

### **Test Login System**
```bash
# Test user authentication
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'
```

### **Test Protected Route**
```bash
# Get user info (requires token)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:3000/api/auth/me
```

### **Test Alert Creation**
```bash
# Create alert (requires authentication)
curl -X POST http://localhost:3000/api/alerts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "userId": "USER_ID",
    "symbol": "BTCUSDT",
    "conditions": {
      "minDaily": "1000000",
      "changePercent": "1HR",
      "timeframe": "1HR",
      "percentage": "5"
    }
  }'
```

## 🔒 **Security Features**

### **Password Security**
- Bcrypt hashing with salt
- Minimum 6 character length
- Password comparison method

### **JWT Security**
- Secret key configuration
- Token expiration (7 days default)
- Bearer token authentication

### **Route Protection**
- Middleware-based protection
- Automatic redirect to login
- Token validation

### **User Management**
- Unique username/email validation
- Account activation/deactivation
- Last login tracking

## 📊 **Database Schema**

### **User Collection**
```javascript
{
  _id: ObjectId,
  username: String,        // Unique
  password: String,       // Hashed
  name: String,
  email: String,          // Unique
  isActive: Boolean,      // Default: true
  lastLogin: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### **Indexes**
```javascript
{ username: 1 }           // Unique username lookup
{ email: 1 }              // Unique email lookup
{ isActive: 1 }           // Active users filter
```

## 🎯 **Usage Examples**

### **Frontend Login**
```javascript
// Login form submission
const handleLogin = async (username, password) => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  
  const data = await response.json();
  if (data.success) {
    localStorage.setItem('token', data.data.token);
    router.push('/dashboard');
  }
};
```

### **Protected API Call**
```javascript
// Make authenticated request
const fetchUserAlerts = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/api/alerts?userId=123', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
};
```

### **Logout**
```javascript
// Clear authentication
const handleLogout = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  router.push('/login');
};
```

## 🚀 **Deployment Notes**

### **Environment Variables**
```env
# Production environment
MONGODB_URI=mongodb://your-production-db
JWT_SECRET=your-super-secure-secret-key
JWT_EXPIRES_IN=7d
```

### **Security Considerations**
1. Change JWT_SECRET in production
2. Use HTTPS in production
3. Set secure cookie options
4. Implement rate limiting
5. Add input validation

## 🎉 **Complete System**

The login system is now fully integrated with:
- ✅ User authentication
- ✅ Protected routes
- ✅ Alert management
- ✅ Alert history
- ✅ Real-time updates
- ✅ Beautiful UI
- ✅ Database seeder

**Ready for production use!** 🚀
