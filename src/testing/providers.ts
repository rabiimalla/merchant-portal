import { provideLocationMocks } from '@angular/common/testing';
import { EnvironmentProviders, Provider } from '@angular/core';
import { provideRouter } from '@angular/router';

/**
 * Router for tests. provideLocationMocks() swaps the real Location for an in-memory one, so
 * tests need neither a <base href> nor a real browser history.
 *
 * The return type must include EnvironmentProviders: provideRouter() returns that branded type,
 * which is deliberately not assignable to Provider.
 */
export const routerTestProviders = (): (Provider | EnvironmentProviders)[] => [provideRouter([]), provideLocationMocks()];
