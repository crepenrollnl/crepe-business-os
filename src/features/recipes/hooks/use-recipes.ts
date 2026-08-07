"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { recipeService } from "../services/recipe-service";
import type {
  ComponentRecipeOption,
  RecipeFormValues,
  RecipeIngredientOption,
  RecipeListItem,
  RecipeSortDirection,
  RecipeSortField,
  RecipeWithRelations,
} from "../types/recipe";
import {
  DEFAULT_RECIPE_ROLE,
  DEFAULT_RECIPE_YIELD_UNIT,
  isRecipeYieldUnit,
} from "../types/recipe";

function compareRecipes(
  a: RecipeListItem,
  b: RecipeListItem,
  sortField: RecipeSortField,
  sortDirection: RecipeSortDirection,
): number {
  const direction = sortDirection === "asc" ? 1 : -1;

  if (sortField === "yield_quantity") {
    return (a.yield_quantity - b.yield_quantity) * direction;
  }

  if (sortField === "item_count") {
    return (a.item_count - b.item_count) * direction;
  }

  return (
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) * direction
  );
}

async function fetchRecipesState() {
  const [recipesResult, ingredientsResult, componentRecipesResult] =
    await Promise.all([
      recipeService.getRecipes(),
      recipeService.getIngredients(),
      recipeService.getComponentRecipes(),
    ]);

  return {
    items: recipesResult.error ? [] : (recipesResult.data ?? []),
    ingredients: ingredientsResult.error ? [] : (ingredientsResult.data ?? []),
    componentRecipes: componentRecipesResult.error
      ? []
      : (componentRecipesResult.data ?? []),
    error:
      recipesResult.error ??
      ingredientsResult.error ??
      componentRecipesResult.error ??
      null,
  };
}

function emptyFormValues(): RecipeFormValues {
  return {
    name: "",
    description: "",
    yield_quantity: null,
    yield_unit: DEFAULT_RECIPE_YIELD_UNIT,
    is_active: true,
    recipe_role: DEFAULT_RECIPE_ROLE,
    lines: [{ ingredient_id: "", quantity: null, unit: "" }],
    components: [{ component_recipe_id: "", quantity: null, unit: "" }],
  };
}

function recipeToFormValues(recipe: RecipeWithRelations): RecipeFormValues {
  return {
    name: recipe.name,
    description: recipe.description ?? "",
    yield_quantity: recipe.yield_quantity,
    yield_unit: isRecipeYieldUnit(recipe.yield_unit)
      ? recipe.yield_unit
      : DEFAULT_RECIPE_YIELD_UNIT,
    is_active: recipe.is_active,
    recipe_role: recipe.recipe_role,
    lines:
      recipe.items.length > 0
        ? recipe.items.map((item) => ({
            ingredient_id: item.ingredient_id,
            quantity: item.quantity,
            unit: item.unit,
          }))
        : [{ ingredient_id: "", quantity: null, unit: "" }],
    components:
      recipe.components.length > 0
        ? recipe.components.map((component) => ({
            component_recipe_id: component.component_recipe_id,
            quantity: component.quantity,
            unit: component.unit,
          }))
        : [{ component_recipe_id: "", quantity: null, unit: "" }],
  };
}

export function useRecipes() {
  const [items, setItems] = useState<RecipeListItem[]>([]);
  const [ingredients, setIngredients] = useState<RecipeIngredientOption[]>([]);
  const [componentRecipes, setComponentRecipes] = useState<
    ComponentRecipeOption[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<RecipeSortField>("name");
  const [sortDirection, setSortDirection] =
    useState<RecipeSortDirection>("asc");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] =
    useState<RecipeWithRelations | null>(null);
  const [isLoadingRecipe, setIsLoadingRecipe] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RecipeListItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const applyState = useCallback(
    (state: Awaited<ReturnType<typeof fetchRecipesState>>) => {
      setItems(state.items);
      setIngredients(state.ingredients);
      setComponentRecipes(state.componentRecipes);
      setError(state.error);
    },
    [],
  );

  const loadRecipes = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true);
      }

      const state = await fetchRecipesState();
      applyState(state);
      setLoading(false);
    },
    [applyState],
  );

  useEffect(() => {
    void (async () => {
      const state = await fetchRecipesState();
      applyState(state);
      setLoading(false);
    })();
  }, [applyState]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const filtered = items.filter((item) => {
      if (normalizedSearch.length === 0) {
        return true;
      }

      return item.name.toLowerCase().includes(normalizedSearch);
    });

    return [...filtered].sort((a, b) =>
      compareRecipes(a, b, sortField, sortDirection),
    );
  }, [items, search, sortField, sortDirection]);

  const hasActiveFilters = search.trim().length > 0;

  const toggleSort = useCallback(
    (field: RecipeSortField) => {
      if (field === sortField) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }

      setSortField(field);
      setSortDirection("asc");
    },
    [sortField],
  );

  const openCreateModal = useCallback(() => {
    setEditingRecipe(null);
    setActionError(null);
    setIsLoadingRecipe(false);
    setIsModalOpen(true);
  }, []);

  const openEditModal = useCallback(async (item: RecipeListItem) => {
    setActionError(null);
    setEditingRecipe(null);
    setIsLoadingRecipe(true);
    setIsModalOpen(true);

    const result = await recipeService.getRecipe(item.id);

    if (result.error || !result.data) {
      setActionError(result.error ?? "Failed to load recipe");
      setEditingRecipe(null);
      setIsLoadingRecipe(false);
      return;
    }

    setEditingRecipe(result.data);
    setIsLoadingRecipe(false);
  }, []);

  const closeModal = useCallback(() => {
    if (isSaving) {
      return;
    }

    setIsModalOpen(false);
    setEditingRecipe(null);
    setActionError(null);
    setIsLoadingRecipe(false);
  }, [isSaving]);

  const openDeleteDialog = useCallback((item: RecipeListItem) => {
    setDeleteTarget(item);
    setActionError(null);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setDeleteTarget(null);
    setActionError(null);
  }, []);

  const saveRecipe = useCallback(
    async (values: RecipeFormValues) => {
      setIsSaving(true);
      setActionError(null);

      const result = editingRecipe
        ? await recipeService.updateRecipe(editingRecipe.id, values)
        : await recipeService.createRecipe(values);

      if (result.error) {
        setActionError(result.error);
        setIsSaving(false);
        return false;
      }

      await loadRecipes({ silent: true });
      setIsSaving(false);
      closeModal();
      return true;
    },
    [closeModal, editingRecipe, loadRecipes],
  );

  const deleteRecipe = useCallback(async () => {
    if (!deleteTarget) {
      return false;
    }

    setIsDeleting(true);
    setActionError(null);

    const result = await recipeService.deleteRecipe(deleteTarget.id);

    if (result.error) {
      setActionError(result.error);
      setIsDeleting(false);
      return false;
    }

    await loadRecipes({ silent: true });
    setIsDeleting(false);
    closeDeleteDialog();
    return true;
  }, [closeDeleteDialog, deleteTarget, loadRecipes]);

  return {
    items: filteredItems,
    totalCount: items.length,
    hasActiveFilters,
    ingredients,
    componentRecipes,
    loading,
    error,
    search,
    setSearch,
    sortField,
    sortDirection,
    toggleSort,
    isModalOpen,
    editingRecipe,
    initialFormValues: editingRecipe
      ? recipeToFormValues(editingRecipe)
      : emptyFormValues(),
    isLoadingRecipe,
    deleteTarget,
    isSaving,
    isDeleting,
    actionError,
    openCreateModal,
    openEditModal,
    closeModal,
    openDeleteDialog,
    closeDeleteDialog,
    saveRecipe,
    deleteRecipe,
    retry: () => loadRecipes(),
  };
}
