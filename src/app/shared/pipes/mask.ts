import { Pipe, PipeTransform } from '@angular/core';
import { maskValue } from './mask-value';

/** Pure pipe: recomputed only when the input value changes. */
@Pipe({ name: 'mask' })
export class Mask implements PipeTransform {
  transform(value: string | null | undefined, visibleTail = 4): string {
    return maskValue(value, visibleTail);
  }
}
