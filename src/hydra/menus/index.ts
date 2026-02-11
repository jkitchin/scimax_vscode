/**
 * Hydra Menus - Pre-built menus for Scimax features
 */

import { HydraMenuDefinition } from '../types';
import { mainMenu } from './mainMenu';
import { journalMenu } from './journalMenu';
import { referencesMenu } from './referencesMenu';
import { notebookMenu } from './notebookMenu';
import { projectileMenu } from './projectileMenu';
import { searchMenu } from './searchMenu';
import { jumpMenu } from './jumpMenu';
import { databaseMenu } from './databaseMenu';
import { templateMenu } from './templateMenu';
import { applicationsMenu } from './applicationsMenu';
import {
    exportMenu,
    htmlExportMenu,
    latexExportMenu,
    markdownExportMenu,
    exportMenus,
    isBodyOnlyMode,
    setBodyOnlyMode,
    toggleBodyOnlyMode,
} from './exportMenu';
import { rectangleMenu } from './rectangleMenu';

/**
 * All pre-built Scimax menus
 */
export const scimaxMenus: HydraMenuDefinition[] = [
    mainMenu,
    journalMenu,
    referencesMenu,
    notebookMenu,
    projectileMenu,
    searchMenu,
    jumpMenu,
    databaseMenu,
    templateMenu,
    applicationsMenu,
    rectangleMenu,
    ...exportMenus,
];

export {
    mainMenu,
    journalMenu,
    referencesMenu,
    notebookMenu,
    projectileMenu,
    searchMenu,
    jumpMenu,
    databaseMenu,
    templateMenu,
    applicationsMenu,
    rectangleMenu,
    exportMenu,
    htmlExportMenu,
    latexExportMenu,
    markdownExportMenu,
    exportMenus,
    isBodyOnlyMode,
    setBodyOnlyMode,
    toggleBodyOnlyMode,
};
