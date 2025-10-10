"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

const FavoritesContext = createContext();

export const useFavorites = () => {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error("useFavorites must be used within a FavoritesProvider");
  }
  return context;
};

export const FavoritesProvider = ({ children }) => {
  const [favorites, setFavorites] = useState(new Set());
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Get favorite symbols from localStorage (fallback) or API
  const getFavoriteSymbols = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        // Fallback to localStorage for guest users
        const favorites = JSON.parse(localStorage.getItem("favorites") || "[]");
        return favorites;
      }

      const response = await fetch("/api/favorites/list", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return data.favorites || [];
      }

      // Fallback to localStorage if API fails
      const favorites = JSON.parse(localStorage.getItem("favorites") || "[]");
      return favorites;
    } catch (error) {
      console.error("Error fetching favorites:", error);
      // Fallback to localStorage
      const favorites = JSON.parse(localStorage.getItem("favorites") || "[]");
      return favorites;
    }
  }, []);

  // Load favorites on mount
  useEffect(() => {
    const loadFavorites = async () => {
      setLoading(true);
      try {
        const favoriteSymbols = await getFavoriteSymbols();
        setFavorites(new Set(favoriteSymbols));
        setFavoriteCount(favoriteSymbols.length);
      } catch (error) {
        console.error("Error loading favorites:", error);
      } finally {
        setLoading(false);
      }
    };

    loadFavorites();
  }, [getFavoriteSymbols]);

  // Update favorites and notify other components
  const updateFavorites = useCallback((newFavorites) => {
    setFavorites(new Set(newFavorites));
    setFavoriteCount(newFavorites.length);

    // Dispatch custom event for other components
    window.dispatchEvent(
      new CustomEvent("favoritesUpdated", {
        detail: { favorites: newFavorites },
      })
    );
  }, []);

  // Check if a symbol is favorited
  const isFavorite = useCallback(
    (symbol) => {
      return favorites.has(symbol);
    },
    [favorites]
  );

  // Add a symbol to favorites
  const addFavorite = useCallback(
    async (symbol) => {
      try {
        const token = localStorage.getItem("token");
        if (!token) {
          console.error("No authentication token found");
          return false;
        }

        const response = await fetch("/api/favorites/add", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ symbol }),
        });

        if (response.ok) {
          const data = await response.json();
          updateFavorites(data.favorites || []);
          return true;
        } else {
          console.error("Failed to add favorite:", await response.text());
          return false;
        }
      } catch (error) {
        console.error("Error adding favorite:", error);
        return false;
      }
    },
    [updateFavorites]
  );

  // Remove a symbol from favorites
  const removeFavorite = useCallback(
    async (symbol) => {
      try {
        const token = localStorage.getItem("token");
        if (!token) {
          console.error("No authentication token found");
          return false;
        }

        const response = await fetch("/api/favorites/remove", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ symbol }),
        });

        if (response.ok) {
          const data = await response.json();
          updateFavorites(data.favorites || []);
          return true;
        } else {
          console.error("Failed to remove favorite:", await response.text());
          return false;
        }
      } catch (error) {
        console.error("Error removing favorite:", error);
        return false;
      }
    },
    [updateFavorites]
  );

  // Toggle favorite status
  const toggleFavorite = useCallback(
    async (symbol) => {
      if (isFavorite(symbol)) {
        return await removeFavorite(symbol);
      } else {
        return await addFavorite(symbol);
      }
    },
    [isFavorite, addFavorite, removeFavorite]
  );

  // Bulk add/remove favorites
  const bulkUpdateFavorites = useCallback(
    async (symbols, action) => {
      try {
        const token = localStorage.getItem("token");
        if (!token) {
          console.error("No authentication token found");
          return false;
        }

        const response = await fetch("/api/favorites/bulk", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            symbols,
            action,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          updateFavorites(data.favorites || []);
          return true;
        } else {
          console.error(`Bulk ${action} failed:`, await response.text());
          return false;
        }
      } catch (error) {
        console.error(`Error bulk ${action}ing favorites:`, error);
        return false;
      }
    },
    [updateFavorites]
  );

  const value = {
    favorites,
    favoriteCount,
    loading,
    isFavorite,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    bulkUpdateFavorites,
    updateFavorites,
    getFavoriteSymbols,
  };

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
};
