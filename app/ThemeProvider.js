"use client";

import { createContext, useContext, useState, useEffect, useMemo } from "react";
import {
  ThemeProvider as MuiThemeProvider,
  createTheme,
  responsiveFontSizes,
} from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

// Create Theme Context
const ThemeContext = createContext({
  mode: "dark",
  toggleTheme: () => {},
});

export const useThemeMode = () => useContext(ThemeContext);

// Create theme based on mode
const getTheme = (mode) => {
  let theme = createTheme({
    palette: {
      mode,
      primary: {
        main: mode === "dark" ? "#1976d2" : "#1565c0",
      },
      secondary: {
        main: mode === "dark" ? "#dc004e" : "#c51162",
      },
      background: {
        default: mode === "dark" ? "#0a0a0a" : "#f5f5f5",
        paper: mode === "dark" ? "#1a1a1a" : "#ffffff",
      },
    },
    typography: {
      fontFamily:
        'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
      htmlFontSize: 16,
      fontSize: 17,
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
            zoom: 1.06,
            transition: "background-color 0.3s ease, color 0.3s ease",
          },
          "@media (max-width:600px)": {
            body: {
              zoom: 1,
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            transition: "background-color 0.3s ease, border-color 0.3s ease",
          },
        },
      },
    },
  });

  return responsiveFontSizes(theme, { factor: 2.5 });
};

export default function ThemeProvider({ children }) {
  const [mode, setMode] = useState("dark");

  // Load theme from localStorage
  useEffect(() => {
    const savedMode = localStorage.getItem("themeMode");
    if (savedMode) {
      setMode(savedMode);
    }
  }, []);

  // Toggle theme
  const toggleTheme = () => {
    const newMode = mode === "dark" ? "light" : "dark";
    setMode(newMode);
    localStorage.setItem("themeMode", newMode);
  };

  const theme = useMemo(() => getTheme(mode), [mode]);

  return (
    <ThemeContext.Provider value={{ mode, toggleTheme }}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
}
