import { Button } from '../Button/Button';
import { Card, CardBody, CardHeader } from './Card';

export const Basic = () => (
  <div className="max-w-md">
    <Card>
      <CardHeader title="Sumário" action={<Button size="sm" variant="ghost">Editar</Button>} />
      <CardBody>
        <p className="font-body text-sm text-text-mid">
          Conteúdo do card usando tokens semânticos do DS v2.
        </p>
      </CardBody>
    </Card>
  </div>
);

export const Elevations = () => (
  <div className="grid max-w-2xl grid-cols-2 gap-4">
    {([1, 2, 3, 4] as const).map((e) => (
      <Card key={e} elevation={e}>
        <CardBody>
          <span className="font-head text-text">elevation {e}</span>
        </CardBody>
      </Card>
    ))}
  </div>
);
