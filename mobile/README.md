# Nexus Mobile - Customer Relation Portal

A React Native mobile application for Customer Relation users to track and monitor customer statuses on-the-go.

## Features

- 🔐 **Secure Authentication** - Login with your Nexus credentials
- 📋 **Personal Watchlist** - Track your assigned customers
- 🔔 **Real-time Notifications** - Get alerts when customers go down
- 📱 **Customer Details** - View full customer information and contact details
- 📞 **Quick Actions** - Call or email customers directly from the app

## Prerequisites

- Node.js 18+ 
- npm or yarn
- Expo CLI
- iOS Simulator (Mac) or Android Emulator

## Installation

1. Navigate to the mobile app directory:
```bash
cd mobile-app
```

2. Install dependencies:
```bash
npm install
```

3. Configure the API URL in `src/utils/api.ts`:
```typescript
export const API_URL = 'http://YOUR_SERVER_IP:4000';
```

## Running the App

### Development

```bash
# Start the Expo development server
npm start

# Run on iOS Simulator
npm run ios

# Run on Android Emulator
npm run android
```

### Using Expo Go

1. Install Expo Go on your phone:
   - [iOS App Store](https://apps.apple.com/app/expo-go/id982107779)
   - [Google Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent)

2. Start the development server:
```bash
npm start
```

3. Scan the QR code with your phone

## Building for Production

### Android APK

```bash
# Build APK
expo build:android -t apk

# Or build AAB for Play Store
expo build:android -t app-bundle
```

### iOS IPA

```bash
# Build for iOS (requires Apple Developer account)
expo build:ios
```

## Project Structure

```
mobile-app/
├── App.tsx              # Main application entry
├── src/
│   ├── context/         # Auth context provider
│   │   └── AuthContext.tsx
│   ├── navigation/      # Navigation configuration
│   │   └── AppNavigator.tsx
│   ├── screens/         # App screens
│   │   ├── LoginScreen.tsx
│   │   ├── HomeScreen.tsx
│   │   ├── WatchlistScreen.tsx
│   │   ├── NotificationsScreen.tsx
│   │   └── CustomerDetailScreen.tsx
│   └── utils/           # Utilities and API
│       └── api.ts
├── package.json
└── app.json             # Expo configuration
```

## Screens

### Login Screen
- Username and password authentication
- Secure token storage using expo-secure-store

### Home/Dashboard Screen
- Welcome message with user role
- Quick stats (watchlist count, alerts count)
- Recent notifications preview

### Watchlist Screen
- List of watched customers with status indicators
- Pull-to-refresh
- Long-press to remove from watchlist
- Tap to view customer details

### Notifications Screen
- All notifications with read/unread status
- Mark as read / Mark all as read
- Delete notifications
- Tap to navigate to customer details

### Customer Detail Screen
- Full customer information
- Contact details (email, phone)
- Add/remove from watchlist
- Direct call and email actions

## API Endpoints Used

- `POST /users/login` - Authentication
- `GET /favorites` - Get user's watchlist
- `POST /favorites` - Add to watchlist
- `DELETE /favorites/:id` - Remove from watchlist
- `GET /notifications` - Get notifications
- `GET /notifications/unread-count` - Get unread count
- `PUT /notifications/:id/read` - Mark as read
- `PUT /notifications/mark-all-read` - Mark all as read
- `DELETE /notifications/:id` - Delete notification
- `GET /customers/:id` - Get DIA customer details
- `GET /iptcustomers/:id` - Get IPT customer details
- `GET /sharedcustomers/:id` - Get Shared customer details

## Push Notifications

The app is configured to receive push notifications when:
- A watched customer goes from UP to DOWN
- Requires Expo push notification token registration

To enable push notifications:
1. The backend must send push notifications using Expo's push service
2. Register device tokens with the backend

## Troubleshooting

### Connection Issues
- Ensure the backend server is running and accessible
- Check the API_URL in `src/utils/api.ts`
- Make sure the phone/emulator is on the same network as the server

### Authentication Errors
- Clear app data and try logging in again
- Verify credentials with the web application

## Support

For issues or feature requests, contact the development team.

---

Built with ❤️ using React Native and Expo

