import { BookScreenContent } from './BookScreenContent';
import { useBookScreenController } from './useBookScreenController';

export default function BookScreen() {
  const controller = useBookScreenController();
  return <BookScreenContent controller={controller} />;
}
