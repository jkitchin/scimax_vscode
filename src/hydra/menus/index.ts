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
import { fileMenu } from './fileMenu';
import {
    exportMenu,
    htmlExportMenu,
    latexExportMenu,
    markdownExportMenu,
    exportMenus,
    mdFileExportMenu,
    mdExportMenus,
    isBodyOnlyMode,
    setBodyOnlyMode,
    toggleBodyOnlyMode,
} from './exportMenu';
import { rectangleMenu } from './rectangleMenu';
import { vcMenu, conflictsMenu } from './vcMenu';

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
    fileMenu,
    rectangleMenu,
    vcMenu,
    conflictsMenu,
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
    fileMenu,
    rectangleMenu,
    vcMenu,
    exportMenu,
    htmlExportMenu,
    latexExportMenu,
    markdownExportMenu,
    exportMenus,
    mdFileExportMenu,
    mdExportMenus,
    isBodyOnlyMode,
    setBodyOnlyMode,
    toggleBodyOnlyMode,
};
