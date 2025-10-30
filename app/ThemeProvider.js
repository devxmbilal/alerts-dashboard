"use client";

import {
  ThemeProvider as MuiThemeProvider,
  createTheme,
  responsiveFontSizes,
} from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

// Create Material-UI theme
let theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#1976d2",
    },
    secondary: {
      main: "#dc004e",
    },
    background: {
      default: "#0a0a0a",
      paper: "#1a1a1a",
    },
  },
  typography: {
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    // Slightly increase the global font sizing for better readability
    htmlFontSize: 16,
    fontSize: 17, // base body size (bigger everywhere)
    h1: { fontSize: "2.6rem" },
    h2: { fontSize: "2.2rem" },
    h3: { fontSize: "1.9rem" },
    h4: { fontSize: "1.6rem" },
    h5: { fontSize: "1.35rem" },
    h6: { fontSize: "1.15rem" },
    body1: { fontSize: "1.12rem" },
    body2: { fontSize: "1.02rem" },
    allVariants: { lineHeight: 1.5 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          // Slight global zoom for better readability on desktops
          zoom: 1.06,
        },
        "@media (max-width:600px)": {
          body: {
            // Avoid zoom on small screens to prevent layout issues
            zoom: 1,
          },
        },
      },
    },
  },
});

// Enable fluid, responsive font sizes across breakpoints
theme = responsiveFontSizes(theme, { factor: 2.5 });

export default function ThemeProvider({ children }) {
  return (
    <MuiThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </MuiThemeProvider>
  );
}
